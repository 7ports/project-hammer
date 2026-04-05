variable "domain_name" {
  description = "Fully-qualified domain name for the frontend (e.g. ferries.yyz.live)."
  type        = string
  default     = "ferries.yyz.live"
}

variable "zone_name" {
  description = "Root domain for the Route53 hosted zone (e.g. yyz.live)."
  type        = string
  default     = "yyz.live"
}

variable "environment" {
  description = "Deployment environment tag applied to all AWS resources."
  type        = string
  default     = "production"
}
