export const guestbookDashboardJson = JSON.stringify({
  __inputs: [],
  __requires: [],
  title: "Guestbook Overview",
  uid: "guestbook-overview-v1",
  schemaVersion: 39,
  version: 1,
  refresh: "30s",
  time: { from: "now-1h", to: "now" },
  tags: ["guestbook", "kubernetes"],

  templating: {
    list: [
      {
        name: "namespace",
        type: "constant",
        query: "guestbook",
        current: { selected: false, text: "guestbook", value: "guestbook" },
        hide: 2, // hidden
      },
    ],
  },

  panels: [
    // ── Row 1: Frontend (Nginx) ───────────────────────────────────────────
    {
      id: 1,
      type: "row",
      title: "Frontend (Nginx)",
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 0 },
      panels: [],
    },
    {
      id: 2,
      type: "timeseries",
      title: "HTTP Request Rate (req/s)",
      description: "Requests per second hitting each frontend pod (nginx-prometheus-exporter)",
      gridPos: { h: 8, w: 12, x: 0, y: 1 },
      options: {
        tooltip: { mode: "multi", sort: "desc" },
        legend: { displayMode: "list", placement: "bottom" },
      },
      fieldConfig: {
        defaults: {
          unit: "reqps",
          custom: { lineWidth: 2, fillOpacity: 10, spanNulls: false },
          color: { mode: "palette-classic" },
        },
      },
      targets: [
        {
          // nginx_http_requests_total is exposed by nginx/nginx-prometheus-exporter.
          expr: 'sum(rate(nginx_http_requests_total{namespace="$namespace"}[2m])) by (pod)',
          legendFormat: "{{pod}}",
          refId: "A",
        },
      ],
    },
    {
      id: 3,
      type: "timeseries",
      title: "Nginx Active Connections",
      description: "Number of active connections reported by Nginx stub_status",
      gridPos: { h: 8, w: 12, x: 12, y: 1 },
      options: {
        tooltip: { mode: "multi", sort: "desc" },
        legend: { displayMode: "list", placement: "bottom" },
      },
      fieldConfig: {
        defaults: {
          unit: "short",
          custom: { lineWidth: 2, fillOpacity: 10 },
          color: { mode: "palette-classic" },
        },
      },
      targets: [
        {
          expr: 'nginx_connections_active{namespace="$namespace"}',
          legendFormat: "{{pod}}",
          refId: "A",
        },
      ],
    },

    // ── Row 2: Redis ──────────────────────────────────────────────────────
    {
      id: 10,
      type: "row",
      title: "Redis",
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 9 },
      panels: [],
    },
    {
      id: 11,
      type: "timeseries",
      title: "Connected Clients",
      description: "redis_connected_clients from redis_exporter sidecars",
      gridPos: { h: 8, w: 8, x: 0, y: 10 },
      options: { tooltip: { mode: "multi" } },
      fieldConfig: {
        defaults: {
          unit: "short",
          custom: { lineWidth: 2, fillOpacity: 5 },
          color: { mode: "palette-classic" },
        },
      },
      targets: [
        {
          // Labels on the scraped metrics will include app="redis-leader" / app="redis-replica"
          // as the pod labels are lifted by the relabeling in ServiceMonitor.
          expr: 'redis_connected_clients{namespace="$namespace"}',
          legendFormat: "{{pod}}",
          refId: "A",
        },
      ],
    },
    {
      id: 12,
      type: "timeseries",
      title: "Memory Used",
      description: "redis_memory_used_bytes from redis_exporter sidecars",
      gridPos: { h: 8, w: 8, x: 8, y: 10 },
      options: { tooltip: { mode: "multi" } },
      fieldConfig: {
        defaults: {
          unit: "bytes",
          custom: { lineWidth: 2, fillOpacity: 5 },
          color: { mode: "palette-classic" },
        },
      },
      targets: [
        {
          expr: 'redis_memory_used_bytes{namespace="$namespace"}',
          legendFormat: "{{pod}}",
          refId: "A",
        },
      ],
    },
    {
      id: 13,
      type: "timeseries",
      title: "Commands Processed / sec",
      description: "Rate of commands processed by Redis",
      gridPos: { h: 8, w: 8, x: 16, y: 10 },
      options: { tooltip: { mode: "multi" } },
      fieldConfig: {
        defaults: {
          unit: "ops",
          custom: { lineWidth: 2, fillOpacity: 10 },
          color: { mode: "palette-classic" },
        },
      },
      targets: [
        {
          expr: 'rate(redis_commands_processed_total{namespace="$namespace"}[2m])',
          legendFormat: "{{pod}}",
          refId: "A",
        },
      ],
    },

    // ── Row 3: Pod Resource Usage ─────────────────────────────────────────
    {
      id: 20,
      type: "row",
      title: "Pod Resource Usage",
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 18 },
      panels: [],
    },
    {
      id: 21,
      type: "timeseries",
      title: "CPU Usage (cores)",
      description: "CPU cores consumed per pod (from cAdvisor via kube-prometheus-stack)",
      gridPos: { h: 8, w: 12, x: 0, y: 19 },
      options: { tooltip: { mode: "multi" } },
      fieldConfig: {
        defaults: {
          unit: "cores",
          custom: { lineWidth: 2, fillOpacity: 10 },
          color: { mode: "palette-classic" },
        },
      },
      targets: [
        {
          expr: `sum(
  rate(container_cpu_usage_seconds_total{
    namespace="$namespace",
    container!="",
    container!="POD"
  }[2m])
) by (pod)`,
          legendFormat: "{{pod}}",
          refId: "A",
        },
      ],
    },
    {
      id: 22,
      type: "timeseries",
      title: "Memory Working Set",
      description: "Memory working set bytes per pod (from cAdvisor)",
      gridPos: { h: 8, w: 12, x: 12, y: 19 },
      options: { tooltip: { mode: "multi" } },
      fieldConfig: {
        defaults: {
          unit: "bytes",
          custom: { lineWidth: 2, fillOpacity: 10 },
          color: { mode: "palette-classic" },
        },
      },
      targets: [
        {
          expr: `sum(
  container_memory_working_set_bytes{
    namespace="$namespace",
    container!="",
    container!="POD"
  }
) by (pod)`,
          legendFormat: "{{pod}}",
          refId: "A",
        },
      ],
    },
  ],
});
