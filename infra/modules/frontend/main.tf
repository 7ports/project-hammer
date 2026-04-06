# modules/frontend/main.tf
#
# Provisions the complete static-hosting stack for the React SPA:
#   - S3 bucket (ca-central-1, private, versioned)
#   - CloudFront OAC + distribution (global, custom domain)
#   - ACM TLS certificate (MUST be in us-east-1 — CloudFront hard requirement)
#   - Route53 hosted zone + alias A record

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
      # Two provider configurations are passed from the root module:
      #   default   -> ca-central-1  (S3)
      #   us_east_1 -> us-east-1     (ACM + CloudFront certs must live here)
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# ---------------------------------------------------------------------------
# Local helpers
# ---------------------------------------------------------------------------

locals {
  # Stable bucket name derived from the domain so it is globally unique and
  # obvious what it belongs to.  Replace dots with hyphens (dots are allowed
  # but cause certificate issues with virtual-hosted-style S3 access).
  bucket_name = replace(var.domain_name, ".", "-")

  common_tags = {
    Project     = "project-hammer"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# S3 bucket — private, versioned, no public access
# CloudFront talks to it via Origin Access Control (OAC), not a public URL.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "frontend" {
  bucket = local.bucket_name

  tags = merge(local.common_tags, {
    Name = local.bucket_name
  })
}

# Block all public access — OAC + bucket policy handles read-only CF access.
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning lets us roll back a bad deploy without losing previous objects.
resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption at rest (SSE-S3 is free and sufficient for static assets).
resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ---------------------------------------------------------------------------
# CloudFront Origin Access Control (OAC)
# OAC is the modern replacement for OAI — it signs requests with SigV4 so S3
# can verify they originate from this specific CloudFront distribution.
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.bucket_name}-oac"
  description                       = "OAC for ${var.domain_name} SPA static assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# S3 bucket policy — allow CloudFront OAC to read objects, deny everything else
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "frontend_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    # Scope the grant to this specific distribution so other CF distributions
    # cannot read from this bucket even if they know the bucket name.
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket_policy.json

  # Bucket policy cannot be applied until public access block is in place.
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

# ---------------------------------------------------------------------------
# ACM certificate — MUST be provisioned in us-east-1 regardless of the S3
# region.  CloudFront is a global service and only reads ACM certs from
# us-east-1.  We use the provider alias to target the correct region.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "frontend" {
  provider = aws.us_east_1

  domain_name       = var.domain_name
  validation_method = "DNS"

  # Create a new cert before destroying the old one to avoid downtime
  # during cert renewals.
  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = "${var.domain_name}-tls"
  })
}

# ---------------------------------------------------------------------------
# Route53 hosted zone for the root domain
# If the zone already exists in your account, import it rather than re-creating:
#   terraform import module.frontend.aws_route53_zone.primary <zone-id>
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "primary" {
  name = var.zone_name

  tags = merge(local.common_tags, {
    Name = var.zone_name
  })
}

# DNS validation record — Terraform reads the validation options from the cert
# resource and creates the required CNAME records in Route53 automatically.
# ACM polls for these records and issues the cert once they resolve (~15-30 min).
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = aws_route53_zone.primary.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60

  allow_overwrite = true
}

# Block Terraform from completing until ACM has validated and issued the cert.
# Without this, the CloudFront distribution creation will fail because the
# certificate ARN resolves to an unvalidated cert.
resource "aws_acm_certificate_validation" "frontend" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ---------------------------------------------------------------------------
# CloudFront distribution
# ---------------------------------------------------------------------------

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [var.domain_name]
  price_class         = "PriceClass_100" # North America + Europe edge locations

  comment = "Toronto Island Ferry Tracker — ${var.domain_name}"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${local.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Default cache behaviour — forward nothing, cache aggressively.
  # The deploy workflow uploads HTML with Cache-Control: no-cache and assets
  # with Cache-Control: public,max-age=31536000,immutable so this TTL
  # acts as a floor only.
  default_cache_behavior {
    target_origin_id       = "S3-${local.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    # Default TTL of 1 day; objects override via Cache-Control headers sent at
    # upload time.  max_ttl caps any object header that tries to cache longer.
    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  # SPA routing: any request that results in a 404 from S3 (because the path
  # is a client-side route) gets rewritten to index.html with a 200.
  # The browser JS router then handles the path.
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  # Also remap 403 (S3 returns 403 for missing keys when OAC is active)
  # to index.html so deep links work correctly.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(local.common_tags, {
    Name = "${var.domain_name}-cdn"
  })

  # Ensure the cert is fully validated before the distribution is created.
  depends_on = [aws_acm_certificate_validation.frontend]
}

# ---------------------------------------------------------------------------
# Route53 A record (alias) — ferries.yyz.live -> CloudFront distribution
# An alias record is free (no per-query charge) and avoids the 30-day TTL
# constraints of CNAME records at the zone apex.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "frontend_alias" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# IPv6 alias record — required because is_ipv6_enabled = true on the distribution.
resource "aws_route53_record" "frontend_alias_ipv6" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
