// ── ALL IMPORTS MUST BE AT THE TOP ──────────────────────────────────────────
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { guestbookDashboardJson } from "./dashboard";

// ─────────────────────────────────────────────────────────────────────────────
// 0. Stack configuration
// ─────────────────────────────────────────────────────────────────────────────
const cfg = new pulumi.Config();

const isMinikube = cfg.getBoolean("isMinikube") ?? false;
const serviceType = isMinikube ? "ClusterIP" : "LoadBalancer";

const grafanaPassword = cfg.getSecret("grafanaPassword") ??
  new random.RandomPassword("grafana-password", {
    length: 20,
    special: true,
    overrideSpecial: "!#%&*-_=+<>?",
  }).result;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Namespaces
// ─────────────────────────────────────────────────────────────────────────────
const guestbookNs = new k8s.core.v1.Namespace("guestbook-ns", {
  metadata: { name: "guestbook" },
});

const monitoringNs = new k8s.core.v1.Namespace("monitoring-ns", {
  metadata: { name: "monitoring" },
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Guestbook application
// ─────────────────────────────────────────────────────────────────────────────

// ── 2a. Redis Leader ─────────────────────────────────────────────────────────
const redisLeaderLabels = { app: "redis-leader" };

const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
  metadata: {
    name: "redis-leader",
    namespace: guestbookNs.metadata.name,
  },
  spec: {
    selector: { matchLabels: redisLeaderLabels },
    replicas: 1,
    template: {
      metadata: {
        labels: redisLeaderLabels,
        annotations: {
          // Annotation-based fallback for the catch-all Prometheus scrape job.
          "prometheus.io/scrape": "true",
          "prometheus.io/port": "9121",
        },
      },
      spec: {
        containers: [
          // Main Redis container – image matches canonical example.
          {
            name: "redis-leader",
            image: "redis",
            resources: {
              requests: { cpu: "100m", memory: "100Mi" },
              limits:   { cpu: "200m", memory: "200Mi" },
            },
            ports: [{ name: "redis", containerPort: 6379 }],
          },
          // Redis exporter sidecar – exposes /metrics on :9121.
          {
            name: "redis-exporter",
            image: "oliver006/redis_exporter:v1.58.0",
            env: [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }],
            ports: [{ name: "metrics", containerPort: 9121 }],
            resources: {
              requests: { cpu: "50m",  memory: "50Mi"  },
              limits:   { cpu: "100m", memory: "100Mi" },
            },
          },
        ],
      },
    },
  },
}, { dependsOn: guestbookNs });

const redisLeaderService = new k8s.core.v1.Service("redis-leader-svc", {
  metadata: {
    name: "redis-leader",
    namespace: guestbookNs.metadata.name,
    labels: redisLeaderLabels,
  },
  spec: {
    selector: redisLeaderLabels,
    ports: [
      { name: "redis",   port: 6379, targetPort: "redis"   },
      { name: "metrics", port: 9121, targetPort: "metrics" },
    ],
  },
}, { dependsOn: redisLeaderDeployment });

// ── 2b. Redis Replica ─────────────────────────────────────────────────────────
const redisReplicaLabels = { app: "redis-replica" };

const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
  metadata: {
    name: "redis-replica",
    namespace: guestbookNs.metadata.name,
  },
  spec: {
    selector: { matchLabels: redisReplicaLabels },
    replicas: 2,
    template: {
      metadata: {
        labels: redisReplicaLabels,
        annotations: {
          "prometheus.io/scrape": "true",
          "prometheus.io/port": "9121",
        },
      },
      spec: {
        containers: [
          {
            name: "redis-replica",
            image: "pulumi/guestbook-redis-replica",
            resources: {
              requests: { cpu: "100m", memory: "100Mi" },
              limits:   { cpu: "200m", memory: "200Mi" },
            },
            env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
            ports: [{ name: "redis", containerPort: 6379 }],
          },
          {
            name: "redis-exporter",
            image: "oliver006/redis_exporter:v1.58.0",
            env: [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }],
            ports: [{ name: "metrics", containerPort: 9121 }],
            resources: {
              requests: { cpu: "50m",  memory: "50Mi"  },
              limits:   { cpu: "100m", memory: "100Mi" },
            },
          },
        ],
      },
    },
  },
}, { dependsOn: [guestbookNs, redisLeaderService] });

const redisReplicaService = new k8s.core.v1.Service("redis-replica-svc", {
  metadata: {
    name: "redis-replica",
    namespace: guestbookNs.metadata.name,
    labels: redisReplicaLabels,
  },
  spec: {
    selector: redisReplicaLabels,
    ports: [
      { name: "redis",   port: 6379, targetPort: "redis"   },
      { name: "metrics", port: 9121, targetPort: "metrics" },
    ],
  },
}, { dependsOn: redisReplicaDeployment });

// ── 2c. Guestbook Frontend ───────────────────────────────────────────────────
const frontendLabels = { app: "frontend" };
const nginxStubStatusConfig = new k8s.core.v1.ConfigMap("nginx-stub-status-cfg", {
  metadata: {
    name: "nginx-stub-status",
    namespace: guestbookNs.metadata.name,
  },
  data: {
    "stub_status.conf": `
server {
    listen 81;
    location /nginx_status {
        stub_status on;
        allow all;
    }
}
`,
  },
}, { dependsOn: guestbookNs });

const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
  metadata: {
    name: "frontend",
    namespace: guestbookNs.metadata.name,
  },
  spec: {
    selector: { matchLabels: frontendLabels },
    replicas: 3,
    template: {
      metadata: {
        labels: frontendLabels,
        annotations: {
          // Annotation-based scrape – nginx exporter on :9113.
          "prometheus.io/scrape": "true",
          "prometheus.io/port": "9113",
          "prometheus.io/path": "/metrics",
        },
      },
      spec: {
        volumes: [
          {
            name: "nginx-stub-status-conf",
            configMap: { name: "nginx-stub-status" },
          },
        ],
        containers: [
          {
            name: "php-redis",
            image: "pulumi/guestbook-php-redis",
            resources: {
              requests: { cpu: "100m", memory: "100Mi" },
              limits:   { cpu: "200m", memory: "200Mi" },
            },
            env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
            ports: [{ name: "http", containerPort: 80 }],
            volumeMounts: [
              {
                name: "nginx-stub-status-conf",
                mountPath: "/etc/nginx/conf.d/stub_status.conf",
                subPath: "stub_status.conf",
                readOnly: true,
              },
            ],
          },
          {
            name: "nginx-exporter",
            image: "nginx/nginx-prometheus-exporter:1.1.0",
            args: ["-nginx.scrape-uri=http://localhost:81/nginx_status"],
            ports: [{ name: "metrics", containerPort: 9113 }],
            resources: {
              requests: { cpu: "50m",  memory: "30Mi" },
              limits:   { cpu: "100m", memory: "64Mi" },
            },
          },
        ],
      },
    },
  },
}, { dependsOn: [guestbookNs, redisLeaderService, redisReplicaService, nginxStubStatusConfig] });

const frontendService = new k8s.core.v1.Service("frontend-svc", {
  metadata: {
    name: "frontend",
    namespace: guestbookNs.metadata.name,
    labels: frontendLabels,
  },
  spec: {
    type: serviceType,
    selector: frontendLabels,
    ports: [
      { name: "http",    port: 80,   targetPort: "http"    },
      { name: "metrics", port: 9113, targetPort: "metrics" },
    ],
  },
}, { dependsOn: frontendDeployment });

// ─────────────────────────────────────────────────────────────────────────────
// 3. Grafana dashboard ConfigMap
// ─────────────────────────────────────────────────────────────────────────────
const dashboardConfigMap = new k8s.core.v1.ConfigMap("guestbook-dashboard", {
  metadata: {
    name: "guestbook-dashboard",
    namespace: monitoringNs.metadata.name,
    labels: { grafana_dashboard: "1" },
  },
  data: {
    "guestbook-overview.json": guestbookDashboardJson,
  },
}, { dependsOn: monitoringNs });

// ─────────────────────────────────────────────────────────────────────────────
// 4. kube-prometheus-stack Helm release
// ─────────────────────────────────────────────────────────────────────────────
const prometheusStack = new k8s.helm.v3.Release("kube-prometheus-stack", {
  chart: "kube-prometheus-stack",
  version: "58.2.1",   // pinned for reproducible deploys
  namespace: monitoringNs.metadata.name,
  repositoryOpts: {
    repo: "https://prometheus-community.github.io/helm-charts",
  },
  createNamespace: false,
  values: {
    // ── Prometheus ──────────────────────────────────────────────────────────
    prometheus: {
      prometheusSpec: {
        serviceMonitorNamespaceSelector: {},
        serviceMonitorSelector: {},
        podMonitorNamespaceSelector: {},
        podMonitorSelector: {},
        retention: "7d",
        resources: {
          requests: { cpu: "200m", memory: "400Mi" },
          limits:   { cpu: "500m", memory: "1Gi"   },
        },
        additionalScrapeConfigs: [
          {
            job_name: "kubernetes-pod-annotations",
            kubernetes_sd_configs: [{ role: "pod" }],
            relabel_configs: [
              {
                source_labels: ["__meta_kubernetes_pod_annotation_prometheus_io_scrape"],
                action: "keep",
                regex: "true",
              },
              {
                source_labels: ["__meta_kubernetes_pod_annotation_prometheus_io_path"],
                action: "replace",
                target_label: "__metrics_path__",
                regex: "(.+)",
              },
              {
                source_labels: [
                  "__address__",
                  "__meta_kubernetes_pod_annotation_prometheus_io_port",
                ],
                action: "replace",
                regex: "([^:]+)(?::\\d+)?;(\\d+)",
                replacement: "$1:$2",
                target_label: "__address__",
              },
              {
                action: "labelmap",
                regex: "__meta_kubernetes_pod_label_(.+)",
              },
              {
                source_labels: ["__meta_kubernetes_namespace"],
                action: "replace",
                target_label: "kubernetes_namespace",
              },
              {
                source_labels: ["__meta_kubernetes_pod_name"],
                action: "replace",
                target_label: "kubernetes_pod_name",
              },
            ],
          },
        ],
      },
    },

    // ── Grafana ──────────────────────────────────────────────────────────────
    grafana: {
      adminPassword: grafanaPassword,
      service: {
        type: serviceType,
        // NodePort only used when isMinikube=true.
        ...(isMinikube ? { nodePort: 32000, type: "NodePort" } : {}),
      },
      sidecar: {
        dashboards: {
          enabled: true,
          label: "grafana_dashboard",
          labelValue: "1",
          searchNamespace: "ALL",
        },
      },
      grafana_ini: {
        server:   { root_url: "%(protocol)s://%(domain)s:%(http_port)s/" },
        security: { allow_embedding: true },
      },
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits:   { cpu: "300m", memory: "256Mi" },
      },
    },

    // ── Alertmanager ─────────────────────────────────────────────────────────
    alertmanager: {
      alertmanagerSpec: {
        resources: {
          requests: { cpu: "50m",  memory: "64Mi"  },
          limits:   { cpu: "100m", memory: "128Mi" },
        },
      },
    },
  },
}, { dependsOn: [monitoringNs, dashboardConfigMap] });

// ─────────────────────────────────────────────────────────────────────────────
// 5. ServiceMonitors
// ─────────────────────────────────────────────────────────────────────────────
// 5a. Frontend – scrapes nginx-prometheus-exporter on port "metrics" (:9113)
const frontendServiceMonitor = new k8s.apiextensions.CustomResource(
  "frontend-service-monitor",
  {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
      name: "guestbook-frontend",
      namespace: monitoringNs.metadata.name,
      labels: { release: "kube-prometheus-stack" },
    },
    spec: {
      namespaceSelector: { matchNames: ["guestbook"] },
      selector: { matchLabels: { app: "frontend" } },
      endpoints: [
        {
          port: "metrics",
          path: "/metrics",
          interval: "15s",
          scrapeTimeout: "10s",
        },
      ],
    },
  },
  { dependsOn: [prometheusStack, frontendService] },
);

// 5b. Redis Leader – scrapes redis-exporter on port "metrics" (:9121)
const redisLeaderServiceMonitor = new k8s.apiextensions.CustomResource(
  "redis-leader-service-monitor",
  {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
      name: "guestbook-redis-leader",
      namespace: monitoringNs.metadata.name,
      labels: { release: "kube-prometheus-stack" },
    },
    spec: {
      namespaceSelector: { matchNames: ["guestbook"] },
      // Matches the redis-leader Service label: { app: "redis-leader" }
      selector: { matchLabels: { app: "redis-leader" } },
      endpoints: [
        {
          port: "metrics",
          path: "/metrics",
          interval: "15s",
          scrapeTimeout: "10s",
        },
      ],
    },
  },
  { dependsOn: [prometheusStack, redisLeaderService] },
);

// 5c. Redis Replica – scrapes redis-exporter on port "metrics" (:9121)
const redisReplicaServiceMonitor = new k8s.apiextensions.CustomResource(
  "redis-replica-service-monitor",
  {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
      name: "guestbook-redis-replica",
      namespace: monitoringNs.metadata.name,
      labels: { release: "kube-prometheus-stack" },
    },
    spec: {
      namespaceSelector: { matchNames: ["guestbook"] },
      selector: { matchLabels: { app: "redis-replica" } },
      endpoints: [
        {
          port: "metrics",
          path: "/metrics",
          interval: "15s",
          scrapeTimeout: "10s",
        },
      ],
    },
  },
  { dependsOn: [prometheusStack, redisReplicaService] },
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Stack Outputs
// ─────────────────────────────────────────────────────────────────────────────

// Guestbook frontend IP/URL
export const frontendIp: pulumi.Output<string> = isMinikube
  ? (frontendService.spec.clusterIP as pulumi.Output<string>)
  : frontendService.status.apply(
      (s) => s.loadBalancer?.ingress?.[0]?.ip
          ?? s.loadBalancer?.ingress?.[0]?.hostname
          ?? "<pending: run 'kubectl get svc frontend -n guestbook'>",
    );

// Grafana URL
const grafanaSvcName = "kube-prometheus-stack-grafana";

export const grafanaUrl: pulumi.Output<string> = prometheusStack.status.apply(() => {
  const svc = k8s.core.v1.Service.get(
    "grafana-svc-lookup",
    pulumi.interpolate`${monitoringNs.metadata.name}/${grafanaSvcName}`,
  );
  if (isMinikube) {
    return pulumi.interpolate`http://<minikube-ip>:32000  (run: minikube service ${grafanaSvcName} -n monitoring --url)`;
  }
  return svc.status.apply(
    (s) =>
      `http://${
        s.loadBalancer?.ingress?.[0]?.ip ??
        s.loadBalancer?.ingress?.[0]?.hostname ??
        "<pending: run 'kubectl get svc kube-prometheus-stack-grafana -n monitoring'>"
      }`,
  );
});

export const grafanaAdminUser = "admin";
export const grafanaAdminPass = grafanaPassword;

export const prometheusNote =
  "Access Prometheus UI: kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n monitoring";
