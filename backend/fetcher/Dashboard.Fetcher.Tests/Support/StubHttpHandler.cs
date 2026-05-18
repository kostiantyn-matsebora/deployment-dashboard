using System.Net;
using System.Net.Http.Headers;
using System.Text;

namespace Dashboard.Fetcher.Tests.Support;

/// <summary>
/// Recording <see cref="DelegatingHandler"/> used as the inner handler on a
/// test <see cref="HttpClient"/>. Tests register one or more matchers that
/// translate an incoming request into a fully-formed <see cref="HttpResponseMessage"/>;
/// every request is captured on <see cref="Requests"/> for later assertion.
///
/// <para>The matcher list is consumed in registration order — the first
/// matcher whose <see cref="Matcher.Predicate"/> returns <c>true</c> handles
/// the request. Use <see cref="EnqueueOnce"/> to make a matcher fire exactly
/// once (useful when modelling a sequence of POSTs where the Nth call must
/// behave differently from the first N-1).</para>
///
/// <para>Unmatched requests throw — fails the test loudly so a missed
/// expectation surfaces as a clear assertion instead of a silent default
/// 404 / 500 from a real handler.</para>
/// </summary>
public sealed class StubHttpHandler : DelegatingHandler
{
    private readonly List<Matcher> _matchers = new();
    public List<CapturedRequest> Requests { get; } = new();

    /// <summary>Register a matcher that fires for every request matching <paramref name="predicate"/>.</summary>
    public StubHttpHandler When(Func<HttpRequestMessage, bool> predicate, Func<HttpResponseMessage> respond)
    {
        _matchers.Add(new Matcher(predicate, respond, OnceOnly: false));
        return this;
    }

    /// <summary>Register a one-shot matcher — the first request matching it gets the response, subsequent requests fall through.</summary>
    public StubHttpHandler EnqueueOnce(Func<HttpRequestMessage, bool> predicate, Func<HttpResponseMessage> respond)
    {
        _matchers.Add(new Matcher(predicate, respond, OnceOnly: true));
        return this;
    }

    /// <summary>Convenience: respond with the given status code + JSON body for every matching request.</summary>
    public StubHttpHandler WhenJson(Func<HttpRequestMessage, bool> predicate, HttpStatusCode status, string json)
        => When(predicate, () => JsonResponse(status, json));

    /// <summary>Convenience: respond with the given status code (no body) for every matching request.</summary>
    public StubHttpHandler WhenStatus(Func<HttpRequestMessage, bool> predicate, HttpStatusCode status)
        => When(predicate, () => new HttpResponseMessage(status));

    /// <summary>Build a JSON response with the canonical <c>application/json</c> content type.</summary>
    public static HttpResponseMessage JsonResponse(HttpStatusCode status, string json)
    {
        var resp = new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        return resp;
    }

    /// <summary>Build a response with a header set on the response itself (e.g. for rate-limit headers).</summary>
    public static HttpResponseMessage WithHeader(HttpResponseMessage resp, string name, string value)
    {
        // Try response headers first; fall back to content headers for the
        // few that live there (Content-Type etc).
        if (!resp.Headers.TryAddWithoutValidation(name, value) && resp.Content is not null)
        {
            resp.Content.Headers.TryAddWithoutValidation(name, value);
        }
        return resp;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // Read body upfront so test assertions can inspect the captured
        // payload without racing the underlying stream.
        string? body = null;
        if (request.Content is not null)
        {
            body = await request.Content.ReadAsStringAsync(cancellationToken);
        }

        var captured = new CapturedRequest(
            request.Method,
            request.RequestUri ?? new Uri("about:blank"),
            request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value), StringComparer.OrdinalIgnoreCase),
            body);
        Requests.Add(captured);

        for (var i = 0; i < _matchers.Count; i++)
        {
            var m = _matchers[i];
            if (!m.Predicate(request)) continue;
            if (m.OnceOnly) _matchers.RemoveAt(i);
            return m.Respond();
        }

        throw new InvalidOperationException(
            $"StubHttpHandler: no matcher for {request.Method} {request.RequestUri}");
    }

    private sealed record Matcher(
        Func<HttpRequestMessage, bool> Predicate,
        Func<HttpResponseMessage> Respond,
        bool OnceOnly);
}

/// <summary>Snapshot of an outbound HTTP call — populated by <see cref="StubHttpHandler"/>.</summary>
public sealed record CapturedRequest(
    HttpMethod Method,
    Uri Uri,
    IReadOnlyDictionary<string, string> Headers,
    string? Body);

/// <summary>
/// Minimal <see cref="IHttpClientFactory"/> built around a single named
/// <see cref="StubHttpHandler"/> — production code unconditionally creates
/// clients via the factory, so test code intercepts there.
/// </summary>
public sealed class StubHttpClientFactory : IHttpClientFactory
{
    private readonly Dictionary<string, StubHttpHandler> _handlers = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Uri> _baseAddresses = new(StringComparer.Ordinal);

    public StubHttpClientFactory Register(string name, StubHttpHandler handler, string baseAddress)
    {
        _handlers[name] = handler;
        _baseAddresses[name] = new Uri(baseAddress);
        return this;
    }

    public HttpClient CreateClient(string name)
    {
        if (!_handlers.TryGetValue(name, out var handler))
        {
            throw new InvalidOperationException($"StubHttpClientFactory: no handler registered for client '{name}'");
        }
        var client = new HttpClient(handler, disposeHandler: false)
        {
            BaseAddress = _baseAddresses[name],
        };
        return client;
    }
}
