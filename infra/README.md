# Infrastructure — Toronto Island Ferry Tracker v2

Terraform manages the frontend hosting stack:

| Resource | Details |
|---|---|
| S3 bucket | `ferries-yyz-live`, region `ca-central-1`, private + versioned |
| CloudFront | Global distribution, `PriceClass_100`, OAC origin |
| ACM cert | `ferries.yyz.live`, provisioned in **us-east-1** (CloudFront requirement) |
| Route53 | Hosted zone for `yyz.live` + alias A/AAAA records |

The backend (Fly.io) is managed via `flyctl`. See `../server/DEPLOY.md`.

---

## Step 0 — Bootstrap (one-time, before `terraform init`)

The S3 state bucket must exist before Terraform can initialise its backend.
Create it manually:

```bash
aws s3api create-bucket \
  --bucket project-hammer-tfstate \
  --region ca-central-1 \
  --create-bucket-configuration LocationConstraint=ca-central-1

# Enable versioning so you can recover from a corrupted state file
aws s3api put-bucket-versioning \
  --bucket project-hammer-tfstate \
  --versioning-configuration Status=Enabled
```

You only need to do this once per AWS account.

---

## Step 1 — Configure AWS credentials

```bash
export AWS_ACCESS_KEY_ID=<value from project-hammer-important-values.txt>
export AWS_SECRET_ACCESS_KEY=<value from project-hammer-important-values.txt>
```

---

## Step 2 — Create your tfvars file

```bash
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars is gitignored — the defaults are correct for this project
```

---

## Step 3 — Initialise and apply

```bash
cd infra/
terraform init
terraform plan     # review — should show ~12 resources to create
terraform apply    # type "yes" when prompted
```

Note: The ACM certificate validation step can take **15-30 minutes**. Terraform
will block at `aws_acm_certificate_validation.frontend` until Route53 propagates
the DNS validation records and ACM confirms issuance. This is normal.

---

## Step 4 — Update your domain registrar nameservers

After `terraform apply` completes, run:

```bash
terraform output name_servers
```

You will see four NS values like:

```
[
  "ns-123.awsdns-45.com.",
  "ns-678.awsdns-90.net.",
  ...
]
```

Log into your registrar (wherever you registered `yyz.live`) and set the
nameservers to these four values. Until this is done, `ferries.yyz.live` will
not resolve.

---

## Step 5 — Copy outputs to GitHub Actions secrets

After apply, gather the values you need for CI/CD:

```bash
terraform output s3_bucket_name           # -> S3_BUCKET_NAME secret
terraform output cloudfront_distribution_id  # -> CLOUDFRONT_DISTRIBUTION_ID secret
```

Add these as GitHub repository secrets alongside the secrets listed in
`.github/workflows/deploy-frontend.yml`.

---

## Step 6 — Smoke test before DNS propagates

CloudFront assigns a `*.cloudfront.net` domain immediately:

```bash
terraform output cloudfront_domain_name
# e.g. d1abc123.cloudfront.net
curl -I https://d1abc123.cloudfront.net/
# Expect: HTTP/2 200
```

---

## Importing an existing Route53 zone

If `yyz.live` already has a hosted zone in Route53, import it instead of
creating a new one (creating a duplicate zone causes DNS split-brain):

```bash
# Get the zone ID from the AWS console or:
aws route53 list-hosted-zones-by-name --dns-name yyz.live

terraform import module.frontend.aws_route53_zone.primary <ZONE_ID>
terraform plan  # should show 0 changes for the zone resource
```

---

## Terraform module structure

```
infra/
  main.tf                    <- providers, backend, module call
  variables.tf               <- root input variables
  outputs.tf                 <- bubbled-up module outputs
  terraform.tfvars.example   <- safe to commit; copy to terraform.tfvars
  modules/
    frontend/
      main.tf                <- all frontend resources
      variables.tf           <- module inputs
      outputs.tf             <- module outputs
```

---

## Cost estimate (monthly)

| Service | Estimate |
|---|---|
| S3 storage + requests | ~$0.05 |
| CloudFront (PriceClass_100) | ~$1-5 depending on traffic |
| Route53 hosted zone | $0.50/zone + $0.40/million queries |
| ACM certificate | Free |
| **Total** | **~$2-6/month** |
