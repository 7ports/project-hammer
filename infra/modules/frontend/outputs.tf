output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — needed for cache invalidations in CI/CD."
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  description = "The *.cloudfront.net domain for the distribution (useful for smoke-testing before DNS is delegated)."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "s3_bucket_name" {
  description = "S3 bucket name for the static site — needed for the S3 sync step in deploy-frontend.yml."
  value       = aws_s3_bucket.frontend.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket (useful for scoping IAM policies)."
  value       = aws_s3_bucket.frontend.arn
}

output "name_servers" {
  description = <<-EOT
    Route53 nameservers for the yyz.live hosted zone.
    IMPORTANT: After first `terraform apply`, copy these four NS values to your
    domain registrar's nameserver configuration.  Until the registrar delegates
    to these NS records, DNS will not resolve and the ACM certificate will not
    validate.
  EOT
  value       = aws_route53_zone.primary.name_servers
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate (us-east-1). Useful if you need to attach the same cert to other resources."
  value       = aws_acm_certificate.frontend.arn
}
