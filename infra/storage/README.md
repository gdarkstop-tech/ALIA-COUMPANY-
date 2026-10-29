# Production photo storage — bucket setup (ADR 0017)

The API stores wound photos as **API-encrypted** objects (AES-256-GCM, key `OBJECT_STORAGE_KEY`
from the secret manager) in a **private** S3-compatible bucket with **SSE-KMS**. No client ever
receives a bucket URL: photos are served only by the API, after an access check, through 120-second
signed links (ADR 0015). Storage stays `NOT_CONFIGURED` until every step below is done **and**
`OBJECT_STORAGE_APPROVAL_REF` names the approval (contract / DPA, DPIA, PDPL licence and, if the
region is outside Egypt, the cross-border transfer authorisation).

The commands use the AWS CLI; any S3-compatible provider with private buckets, versioning,
lifecycle rules and a KMS (or provider-managed encryption with `S3_SSE=provider-default`) works.
Replace `BUCKET_NAME`, `KMS_KEY_ARN`, `REGION` in the JSON files first.

| # | Step | Command / file |
|---|---|---|
| 1 | Customer-managed KMS key, rotation on, used only by this bucket | `aws kms create-key --description dmw-photos` · `aws kms enable-key-rotation --key-id …` · alias `alias/dmw-photos` |
| 2 | Bucket in the approved region | `aws s3api create-bucket --bucket BUCKET_NAME --region REGION --create-bucket-configuration LocationConstraint=REGION` |
| 3 | Block every form of public access | `aws s3api put-public-access-block --bucket BUCKET_NAME --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true` |
| 4 | Object ownership: bucket owner enforced (no ACLs) | `aws s3api put-bucket-ownership-controls --bucket BUCKET_NAME --ownership-controls Rules=[{ObjectOwnership=BucketOwnerEnforced}]` |
| 5 | Default encryption SSE-KMS with bucket key | `aws s3api put-bucket-encryption --bucket BUCKET_NAME --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"KMS_KEY_ARN"},"BucketKeyEnabled":true}]}'` |
| 6 | Versioning (backups) | `aws s3api put-bucket-versioning --bucket BUCKET_NAME --versioning-configuration Status=Enabled` |
| 7 | Lifecycle: old versions erased after 30 days, failed uploads after 1 day | `aws s3api put-bucket-lifecycle-configuration --bucket BUCKET_NAME --lifecycle-configuration file://lifecycle.json` |
| 8 | Bucket policy: TLS ≥ 1.2 only, SSE-KMS with this key only | `aws s3api put-bucket-policy --bucket BUCKET_NAME --policy file://bucket-policy.json` |
| 9 | API role: objects under `w/` and `r/`, verification canaries under `v/`, KMS via S3 only | `api-role-policy.json` (attach to the API's workload identity; prefer short-lived role credentials over static keys) |
| 10 | Access logging: CloudTrail **data events** for the bucket (or server access logs to a separate, locked bucket) | retained per the audit-log policy |
| 11 | No CORS configuration, no static website hosting, no presigned URLs | (nothing to apply — verify none exist) |
| 12 | Optional: replication to a second approved region for disaster recovery | only if the transfer authorisation covers it; the replica needs the same lifecycle |

Then, with the production environment variables set (`S3_ENDPOINT` https, `S3_REGION`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` or role credentials, `S3_SSE=aws:kms`,
`S3_KMS_KEY_ID`, `OBJECT_STORAGE_KEY`, `OBJECT_STORAGE_APPROVAL_REF`):

```
pnpm --filter @ghayarly/api storage:verify
```

It must print `VERIFIED`: HTTPS, bucket reachable, versioning, lifecycle ≤ 35 days, SSE-KMS with
the configured key on a written object, ciphertext at rest, **anonymous object read and listing
refused**, ciphertext bound to its key, delete → restore from the previous version, canary removed.
Keep the output as evidence with the approval reference. Re-run after any bucket change.

## Retention and deletion
- A person's deletion (photo, case, all wound data, account) removes the database rows at once and
  queues the objects; the purge deletes them (a delete marker in a versioned bucket). The previous
  versions — the backup — are erased by the lifecycle rule within **30 days**. The privacy notice says so.
- Research copies (`r/`) follow the dataset's retention date and are destroyed on withdrawal (ADR 0015).
- Backups of the database follow the hosting provider's point-in-time recovery window (≤ 30 days);
  `scripts/ops/db-backup-restore-drill.sh` is the restore drill.

## Limits enforced by the API
12 MB per photo, JPEG/PNG detected from the bytes (declared type must match), metadata (EXIF/GPS,
PNG text) removed and a ≤ 1024 px derivative re-encoded, 20 uploads per minute and 200 photos or
documents per account per day (ADR 0016).
