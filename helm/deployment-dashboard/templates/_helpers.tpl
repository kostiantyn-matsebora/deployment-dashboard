{{/*
Expand the name of the chart.
*/}}
{{- define "deployment-dashboard.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "deployment-dashboard.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version as used by the chart label.
*/}}
{{- define "deployment-dashboard.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "deployment-dashboard.labels" -}}
helm.sh/chart: {{ include "deployment-dashboard.chart" . }}
{{ include "deployment-dashboard.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (base — component added per resource).
*/}}
{{- define "deployment-dashboard.selectorLabels" -}}
app.kubernetes.io/name: {{ include "deployment-dashboard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Per-component selector labels — pass (dict "root" . "component" "api") etc.
*/}}
{{- define "deployment-dashboard.componentSelectorLabels" -}}
{{ include "deployment-dashboard.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Per-component labels (common + component).
*/}}
{{- define "deployment-dashboard.componentLabels" -}}
{{ include "deployment-dashboard.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Per-component resource name — <fullname>-<component>.
*/}}
{{- define "deployment-dashboard.componentName" -}}
{{- printf "%s-%s" (include "deployment-dashboard.fullname" .root) .component | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully-qualified image reference for a component.
Usage: include "deployment-dashboard.image" (dict "root" . "component" "api")
*/}}
{{- define "deployment-dashboard.image" -}}
{{- $tag := .root.Values.image.tag | default .root.Chart.AppVersion }}
{{- printf "%s/%s/deployment-dashboard-%s:%s" .root.Values.image.registry .root.Values.image.repository .component $tag }}
{{- end }}

{{/*
Name of the Secret holding API_KEY / CONTROL_API_KEY.
*/}}
{{- define "deployment-dashboard.apiSecretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- printf "%s-api" (include "deployment-dashboard.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Name of the Secret holding the bundled PostgreSQL password.
*/}}
{{- define "deployment-dashboard.postgresSecretName" -}}
{{- if .Values.postgresql.auth.existingSecret }}
{{- .Values.postgresql.auth.existingSecret }}
{{- else }}
{{- printf "%s-postgresql" (include "deployment-dashboard.fullname" .) }}
{{- end }}
{{- end }}

{{/*
PostgreSQL host:port the API/Fetcher connect to — bundled Service or external.
*/}}
{{- define "deployment-dashboard.postgresHost" -}}
{{- if .Values.postgresql.enabled }}
{{- include "deployment-dashboard.componentName" (dict "root" . "component" "postgresql") }}
{{- else }}
{{- .Values.externalDatabase.host }}
{{- end }}
{{- end }}

{{- define "deployment-dashboard.postgresPort" -}}
{{- if .Values.postgresql.enabled }}
5432
{{- else }}
{{- .Values.externalDatabase.port }}
{{- end }}
{{- end }}
