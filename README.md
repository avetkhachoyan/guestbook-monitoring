# guestbook-monitoring

## Quick Start

```bash
npm install
pulumi login --local   # local file — no account needed
pulumi stack init dev
pulumi preview --diff
pulumi up
pulumi stack output --show-secrets
```
---

## Dry Run

```bash
pulumi preview                         # summary of planned operations
pulumi preview --save-plan plan.json   # save plan to enforce at deploy time
pulumi up      --plan plan.json        # deploy only what the saved plan described
```

---

## Configuration

All keys live under `guestbook-monitoring:` in `Pulumi.dev.yaml`.
```bash
pulumi config set guestbook-monitoring:isMinikube true
pulumi config set --secret guestbook-monitoring:grafanaPassword 'S3cret!'
```

---

## Minikube

```bash
minikube start --cpus=4 --memory=6g
pulumi config set guestbook-monitoring:isMinikube true
pulumi up

minikube service frontend -n guestbook --url        # guestbook
echo "http://$(minikube ip):32000"                  # Grafana
```

---

## Verify Prometheus is Scraping

```bash
kubectl get servicemonitors -n monitoring
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n monitoring
POD=$(kubectl get pod -n guestbook -l app=frontend -o name | head -1)
kubectl exec -n guestbook "$POD" -c nginx-exporter -- wget -qO- http://localhost:9113/metrics | grep nginx_http_requests
```

---

---

## Tear Down

```bash
pulumi destroy && pulumi stack rm dev
```

---
