# Cloud Run deployment configuration

The Dockerfile runs the Express API and built React demo. `cloud-run.sh` is a private Cloud Run deployment recipe that attaches an existing Cloud SQL instance and reads the database password from Secret Manager. Review the script for the project, region, service account, instance, database user, and secret variables it expects.

The image does not bundle VenueMatch. Core booking endpoints run without it. If you deploy the companion service, configure `AGENT_URL` and supply service authentication appropriate to your environment before using the integration routes.
