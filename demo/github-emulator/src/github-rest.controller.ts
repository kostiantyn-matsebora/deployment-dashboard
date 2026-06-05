import {
  Controller, Get, Param, Query, Res, Req,
} from '@nestjs/common';
import { Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver') as typeof import('archiver');
import { GithubStoreService } from './github-store.service';
import { applyRateLimitHeaders, applyLinkHeader, globalBudget } from './rate-limit-headers';

const NOT_FOUND_BODY = {
  message:           'Not Found',
  documentation_url: 'https://docs.github.com/rest',
};

@Controller()
export class GithubRestController {
  constructor(private readonly storeService: GithubStoreService) {}

  // ── GET /rate_limit ────────────────────────────────────────────────────────

  @Get('rate_limit')
  getRateLimit(@Res() res: Response): void {
    applyRateLimitHeaders(res);
    const snap = globalBudget.snapshot();
    res.json({
      resources: {
        core: {
          limit:     snap.limit,
          remaining: snap.remaining,
          used:      snap.used,
          reset:     snap.reset,
        },
      },
    });
  }

  // ── GET /repos/:owner/:repo/deployments ────────────────────────────────────

  @Get('repos/:owner/:repo/deployments')
  listDeployments(
    @Param('owner') owner: string,
    @Param('repo')  repo:  string,
    @Query('environment') environment: string | undefined,
    @Query('per_page')    perPageStr:  string | undefined,
    @Query('page')        pageStr:     string | undefined,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    let items = [...repoStore.deployments];

    if (environment) {
      items = items.filter(d => d.environment === environment);
    }

    // Newest-first
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const perPage = Math.max(1, parseInt(perPageStr ?? '30', 10));
    const page    = Math.max(1, parseInt(pageStr    ?? '1',  10));
    const start   = (page - 1) * perPage;
    const paged   = items.slice(start, start + perPage);

    applyLinkHeader(res, owner, repo, 'deployments', page, perPage, items.length);

    // Strip internal fields before responding
    res.json(paged.map(d => ({
      id:          d.id,
      sha:         d.sha,
      ref:         d.ref,
      environment: d.environment,
      payload:     d.payload,
      creator:     d.creator,
      created_at:  d.created_at,
    })));
  }

  // ── GET /repos/:owner/:repo/deployments/:id/statuses ──────────────────────

  @Get('repos/:owner/:repo/deployments/:id/statuses')
  listStatuses(
    @Param('owner') owner: string,
    @Param('repo')  repo:  string,
    @Param('id')    idStr: string,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const id = parseInt(idStr, 10);
    const statuses = repoStore.statuses.get(id);

    if (!statuses) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    // Newest-first
    const sorted = [...statuses].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    res.json(sorted.map(s => ({
      id:         s.id,
      state:      s.state,
      target_url: s.target_url,
      creator:    s.creator,
      created_at: s.created_at,
    })));
  }

  // ── GET /repos/:owner/:repo/deployments/:id/reviews ───────────────────────

  @Get('repos/:owner/:repo/deployments/:id/reviews')
  listReviews(
    @Param('owner') owner: string,
    @Param('repo')  repo:  string,
    @Param('id')    idStr: string,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const id      = parseInt(idStr, 10);
    const reviews = repoStore.reviews.get(id) ?? [];

    res.json(reviews.map(r => ({
      state:        r.state,
      user:         r.user,
      submitted_at: r.submitted_at,
    })));
  }

  // ── GET /repos/:owner/:repo/actions/runs/:run_id ──────────────────────────

  @Get('repos/:owner/:repo/actions/runs/:run_id')
  getRun(
    @Param('owner')  owner:    string,
    @Param('repo')   repo:     string,
    @Param('run_id') runIdStr: string,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const runId = parseInt(runIdStr, 10);
    const run   = repoStore.runs.get(runId);

    if (!run) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    res.json({
      id:         run.id,
      name:       run.name,
      path:       run.path,
      head_sha:   run.head_sha,
      conclusion: run.conclusion ?? null,
    });
  }

  // ── GET /repos/:owner/:repo/contents/:path ────────────────────────────────

  @Get('repos/:owner/:repo/contents/*')
  getContents(
    @Param('owner') owner:   string,
    @Param('repo')  repo:    string,
    @Param('0')     wildcard: string,
    @Query('ref')   ref:     string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    // Use @Param('0') wildcard capture; fall back to URL extraction if needed
    let filePath = wildcard ?? '';
    if (!filePath) {
      const rawUrl = req.url ?? '';
      const contentsMatch = rawUrl.match(/\/repos\/[^/]+\/[^/]+\/contents\/(.+?)(?:\?.*)?$/);
      filePath = contentsMatch ? decodeURIComponent(contentsMatch[1]) : '';
    }

    if (!filePath) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    // Try exact ref first, then any ref that has the file
    const key      = ref ? `${filePath}::${ref}` : '';
    let yaml: string | undefined;

    if (key) yaml = repoStore.workflowYaml.get(key);

    if (!yaml) {
      // Fall back: find any entry matching the path
      for (const [k, v] of repoStore.workflowYaml) {
        if (k.startsWith(`${filePath}::`)) { yaml = v; break; }
      }
    }

    if (!yaml) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const encoded = Buffer.from(yaml, 'utf-8').toString('base64');
    res.json({ content: encoded, encoding: 'base64' });
  }

  // ── GET /repos/:owner/:repo/actions/workflows ─────────────────────────────

  @Get('repos/:owner/:repo/actions/workflows')
  listWorkflows(
    @Param('owner') owner: string,
    @Param('repo')  repo:  string,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const workflows = repoStore.workflows.map(w => ({
      id:    w.id,
      name:  w.name,
      path:  w.path,
      state: w.state,
    }));

    res.json({ total_count: workflows.length, workflows });
  }

  // ── GET /repos/:owner/:repo/environments ──────────────────────────────────

  @Get('repos/:owner/:repo/environments')
  listEnvironments(
    @Param('owner') owner: string,
    @Param('repo')  repo:  string,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const environments = repoStore.environments.map(e => ({ name: e.name }));
    res.json({ total_count: environments.length, environments });
  }

  // ── GET /repos/:owner/:repo/actions/runs/:run_id/artifacts ───────────────

  @Get('repos/:owner/:repo/actions/runs/:run_id/artifacts')
  listArtifacts(
    @Param('owner')  owner:    string,
    @Param('repo')   repo:     string,
    @Param('run_id') runIdStr: string,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const runId    = parseInt(runIdStr, 10);
    const artifacts = repoStore.artifacts.get(runId) ?? [];

    res.json({
      total_count: artifacts.length,
      artifacts:   artifacts.map(a => ({ id: a.id, name: a.name, expired: a.expired })),
    });
  }

  // ── GET /repos/:owner/:repo/actions/artifacts/:artifact_id/zip ───────────

  @Get('repos/:owner/:repo/actions/artifacts/:artifact_id/zip')
  downloadArtifact(
    @Param('owner')       owner:         string,
    @Param('repo')        repo:          string,
    @Param('artifact_id') artifactIdStr: string,
    @Res() res: Response,
  ): void {
    applyRateLimitHeaders(res);

    const repoStore = this.storeService.getStore().getRepo(owner, repo);
    if (!repoStore) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const artifactId = parseInt(artifactIdStr, 10);
    let foundArtifact: { name: string; _content: string } | undefined;

    for (const arts of repoStore.artifacts.values()) {
      const match = arts.find(a => a.id === artifactId);
      if (match) { foundArtifact = match; break; }
    }

    if (!foundArtifact) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const content = foundArtifact._content;
    const filename = foundArtifact.name;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: Error) => {
      console.error('[github-emulator] archiver error', err);
      if (!res.headersSent) res.status(500).end();
    });

    archive.pipe(res);
    archive.append(Buffer.from(content, 'utf-8'), { name: filename });
    archive.finalize();
  }
}
