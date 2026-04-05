# Bubble module outputs up to the root so they appear in `terraform output`.

output "cloudfront_distribution_id" {
  description = "Set this as the CLOUDFRONT_DISTRIBUTION_ID GitHub Actions secret."
  value       = module.frontend.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  description = "Smoke-test URL (before DNS delegation): https://<this value>"
  value       = module.frontend.cloudfront_domain_name
}

output "s3_bucket_name" {
  description = "Set this as the S3_BUCKET_NAME GitHub Actions secret."
  value       = module.frontend.s3_bucket_name
}

output "name_servers" {
  description = "Copy these NS values to your registrar after the first apply."
  value       = module.frontend.name_servers
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN (us-east-1)."
  value       = module.frontend.acm_certificate_arn
}
