#!/usr/bin/env node
// Build catalog/connectors.json.
//
// Only entries with a real, public remote MCP endpoint are marked `mcp`; those
// can be added, inspected and used by Wiggle. Connectors that Anthropic or
// OpenAI host themselves (Gmail, Microsoft 365, Slack, ...) are marked
// `hosted`: they run inside those products and have no public MCP URL, so the
// app links to the vendor instead of pretending to install them.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const M = (id, name, vendor, category, description, url, auth, docs, transport = 'http') =>
  ({ id, name, vendor, category, description, kind: 'mcp', transport, url, auth, docs });
const H = (id, name, vendor, category, description, docs) =>
  ({ id, name, vendor, category, description, kind: 'hosted', docs });

const connectors = [
  /* ------------------------------- development ------------------------------- */
  M('github', 'GitHub', 'GitHub', 'development', 'Repositories, issues, pull requests and code search.', 'https://api.githubcopilot.com/mcp/', 'token', 'https://github.com/github/github-mcp-server'),
  M('gitlab', 'GitLab', 'GitLab', 'development', 'Projects, merge requests and pipelines through the official GitLab MCP server.', 'https://gitlab.com/api/v4/mcp', 'oauth', 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/'),
  M('sentry', 'Sentry', 'Sentry', 'development', 'Errors, traces and releases.', 'https://mcp.sentry.dev/mcp', 'oauth', 'https://docs.sentry.io/product/sentry-mcp/'),
  M('postman', 'Postman', 'Postman', 'development', 'API collections, environments and mock servers.', 'https://mcp.postman.com/minimal', 'oauth', 'https://learning.postman.com/docs/developer/postman-api/intro-api/'),
  M('semgrep', 'Semgrep', 'Semgrep', 'development', 'Static analysis findings and secure-code guidance.', 'https://mcp.semgrep.dev/mcp', 'oauth', 'https://semgrep.dev/docs/'),
  M('context7', 'Context7', 'Upstash', 'development', 'Version-accurate library documentation for coding agents.', 'https://mcp.context7.com/mcp', 'none', 'https://github.com/upstash/context7'),
  M('deepwiki', 'DeepWiki', 'Cognition', 'development', 'Ask questions about any public GitHub repository.', 'https://mcp.deepwiki.com/mcp', 'none', 'https://deepwiki.com'),
  M('huggingface', 'Hugging Face', 'Hugging Face', 'development', 'Models, datasets and Spaces.', 'https://huggingface.co/mcp', 'oauth', 'https://huggingface.co/docs/hub/mcp'),
  M('apify', 'Apify', 'Apify', 'development', 'Run actors and scrape structured web data.', 'https://mcp.apify.com', 'token', 'https://docs.apify.com/platform/integrations/mcp'),
  M('firecrawl', 'Firecrawl', 'Firecrawl', 'development', 'Crawl, scrape and extract content from websites.', 'https://mcp.firecrawl.dev/v2/mcp', 'token', 'https://docs.firecrawl.dev/mcp'),
  M('browserbase', 'Browserbase', 'Browserbase', 'development', 'Cloud browser sessions for agents.', 'https://mcp.browserbase.com/mcp', 'token', 'https://docs.browserbase.com/'),
  M('exa', 'Exa', 'Exa', 'development', 'Neural web search for agents.', 'https://mcp.exa.ai/mcp', 'token', 'https://docs.exa.ai/reference/exa-mcp'),
  M('e2b', 'E2B', 'E2B', 'development', 'Sandboxed code execution environments.', 'https://mcp.e2b.dev/mcp', 'token', 'https://e2b.dev/docs'),

  /* -------------------------------- databases -------------------------------- */
  M('supabase', 'Supabase', 'Supabase', 'database', 'Postgres projects, SQL and edge functions.', 'https://mcp.supabase.com/mcp', 'oauth', 'https://supabase.com/docs/guides/getting-started/mcp'),
  M('neon', 'Neon', 'Neon', 'database', 'Serverless Postgres projects and branches.', 'https://mcp.neon.tech/mcp', 'oauth', 'https://neon.tech/docs/ai/neon-mcp-server'),
  M('clickhouse', 'ClickHouse', 'ClickHouse', 'database', 'Query ClickHouse Cloud databases.', 'https://mcp.clickhouse.cloud/mcp', 'oauth', 'https://clickhouse.com/docs/use-cases/AI/MCP'),
  M('astra', 'Astra DB', 'DataStax', 'database', 'Serverless vector database collections.', 'https://api.astra.datastax.com/v2/mcp', 'token', 'https://docs.datastax.com/en/astra-db-serverless/'),
  M('sanity', 'Sanity', 'Sanity', 'database', 'Content lake documents and schemas.', 'https://mcp.sanity.io/mcp', 'oauth', 'https://www.sanity.io/docs'),
  M('prisma', 'Prisma Postgres', 'Prisma', 'database', 'Managed Postgres through Prisma.', 'https://mcp.prisma.io/mcp', 'oauth', 'https://www.prisma.io/docs'),
  H('snowflake', 'Snowflake', 'Snowflake', 'database', 'Warehouse queries through the hosted Snowflake connector.', 'https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp'),
  H('databricks', 'Databricks', 'Databricks', 'database', 'Lakehouse SQL and notebooks through the hosted connector.', 'https://docs.databricks.com/aws/en/generative-ai/mcp/'),
  H('bigquery', 'BigQuery', 'Google Cloud', 'database', 'Warehouse queries through the Google Cloud connector.', 'https://cloud.google.com/bigquery/docs'),
  H('mongodb', 'MongoDB', 'MongoDB', 'database', 'Atlas clusters through the hosted MongoDB connector.', 'https://www.mongodb.com/docs/mcp-server/'),
  H('redis', 'Redis', 'Redis', 'database', 'Cloud databases through the Redis connector.', 'https://redis.io/docs/latest/develop/ai/mcp/'),

  /* ------------------------------- productivity ------------------------------- */
  M('notion', 'Notion', 'Notion', 'productivity', 'Workspace pages, databases and comments.', 'https://mcp.notion.com/mcp', 'oauth', 'https://developers.notion.com/docs/mcp'),
  M('linear', 'Linear', 'Linear', 'productivity', 'Issues, projects and team context.', 'https://mcp.linear.app/mcp', 'oauth', 'https://linear.app/docs/mcp'),
  M('atlassian', 'Atlassian Rovo', 'Atlassian', 'productivity', 'Jira issues and Confluence pages.', 'https://mcp.atlassian.com/v1/sse', 'oauth', 'https://support.atlassian.com/atlassian-rovo-mcp-server/', 'sse'),
  M('asana', 'Asana', 'Asana', 'productivity', 'Tasks, projects and portfolios.', 'https://mcp.asana.com/v2/mcp', 'oauth', 'https://developers.asana.com/docs/using-asanas-model-context-protocol-mcp-server'),
  M('monday', 'monday.com', 'monday.com', 'productivity', 'Boards, items and automations.', 'https://mcp.monday.com/mcp', 'oauth', 'https://developer.monday.com/apps/docs/mondaycom-mcp'),
  M('airtable', 'Airtable', 'Airtable', 'productivity', 'Bases records and schemas.', 'https://mcp.airtable.com/mcp', 'oauth', 'https://support.airtable.com/docs/airtable-mcp-server'),
  M('smartsheet', 'Smartsheet', 'Smartsheet', 'productivity', 'Sheets, rows and attachments.', 'https://mcp.smartsheet.com', 'oauth', 'https://developers.smartsheet.com/'),
  M('miro', 'Miro', 'Miro', 'productivity', 'Boards, frames and sticky notes.', 'https://mcp.miro.com/mcp', 'oauth', 'https://developers.miro.com/docs/miro-mcp'),
  M('canva', 'Canva', 'Canva', 'productivity', 'Designs, assets and brand templates.', 'https://mcp.canva.com/mcp', 'oauth', 'https://www.canva.dev/docs/connect/'),
  M('hubspot', 'HubSpot', 'HubSpot', 'productivity', 'CRM contacts, companies and deals.', 'https://mcp.hubspot.com', 'oauth', 'https://developers.hubspot.com/mcp'),
  M('intercom', 'Intercom', 'Intercom', 'productivity', 'Conversations, contacts and help-centre content.', 'https://mcp.intercom.com/mcp', 'oauth', 'https://developers.intercom.com/'),
  M('pagerduty', 'PagerDuty', 'PagerDuty', 'productivity', 'Incidents, schedules and on-call context.', 'https://mcp.pagerduty.com/mcp', 'oauth', 'https://developer.pagerduty.com/'),
  M('attio', 'Attio', 'Attio', 'productivity', 'CRM records and workflows.', 'https://mcp.attio.com/mcp', 'oauth', 'https://developers.attio.com/'),
  H('gmail', 'Gmail', 'Google', 'productivity', 'Read, search and draft email. Hosted by Claude and ChatGPT.', 'https://support.google.com/mail/answer/15082318'),
  H('google-calendar', 'Google Calendar', 'Google', 'productivity', 'Calendars, events and availability. Hosted connector.', 'https://support.google.com/calendar/answer/15082318'),
  H('google-drive', 'Google Drive', 'Google', 'productivity', 'Files and documents. Hosted connector.', 'https://support.google.com/drive/answer/15082318'),
  H('google-docs', 'Google Docs', 'Google', 'productivity', 'Documents and comments. Hosted connector.', 'https://workspace.google.com/products/docs/'),
  H('microsoft-outlook', 'Outlook Mail', 'Microsoft', 'productivity', 'Mail and calendar through Microsoft 365. Hosted connector.', 'https://learn.microsoft.com/microsoft-365-copilot/'),
  H('microsoft-teams', 'Microsoft Teams', 'Microsoft', 'productivity', 'Chats, channels and meetings. Hosted connector.', 'https://learn.microsoft.com/microsoftteams/'),
  H('onedrive', 'OneDrive', 'Microsoft', 'productivity', 'Files and folders in Microsoft 365. Hosted connector.', 'https://learn.microsoft.com/onedrive/'),
  H('sharepoint', 'SharePoint', 'Microsoft', 'productivity', 'Sites and document libraries. Hosted connector.', 'https://learn.microsoft.com/sharepoint/'),
  H('slack', 'Slack', 'Salesforce', 'productivity', 'Channels, messages and search. Hosted connector.', 'https://docs.slack.dev/ai/slack-mcp-server/'),
  H('dropbox', 'Dropbox', 'Dropbox', 'productivity', 'Files and shared links. Hosted connector.', 'https://help.dropbox.com/integrations/ai'),
  H('box', 'Box', 'Box', 'productivity', 'Content and metadata. Box publishes a remote MCP server for enterprise tenants.', 'https://developer.box.com/guides/box-mcp/'),
  H('zoom', 'Zoom', 'Zoom', 'productivity', 'Meetings and transcripts. Hosted connector.', 'https://developers.zoom.us/docs/'),
  H('calendly', 'Calendly', 'Calendly', 'productivity', 'Scheduling links and events. Hosted connector.', 'https://developer.calendly.com/'),
  H('trello', 'Trello', 'Atlassian', 'productivity', 'Boards, lists and cards. Hosted connector.', 'https://developer.atlassian.com/cloud/trello/'),
  H('clickup', 'ClickUp', 'ClickUp', 'productivity', 'Tasks, docs and goals. Hosted connector.', 'https://developer.clickup.com/'),
  H('coda', 'Coda', 'Coda', 'productivity', 'Docs, tables and packs. Hosted connector.', 'https://coda.io/developers'),
  H('egnyte', 'Egnyte', 'Egnyte', 'productivity', 'Enterprise content. Hosted connector.', 'https://developers.egnyte.com/'),
  H('zapier', 'Zapier', 'Zapier', 'automation', 'Run Zaps and thousands of app actions.', 'https://zapier.com/mcp'),
  H('make', 'Make', 'Make', 'automation', 'Scenario automation across connected apps.', 'https://www.make.com/en/help/apps/make-mcp'),

  /* --------------------------------- finance --------------------------------- */
  M('stripe', 'Stripe', 'Stripe', 'finance', 'Payments, customers and product catalog.', 'https://mcp.stripe.com', 'oauth', 'https://docs.stripe.com/mcp'),
  M('paypal', 'PayPal', 'PayPal', 'finance', 'Transactions, invoices and disputes.', 'https://mcp.paypal.com/mcp', 'oauth', 'https://developer.paypal.com/'),
  M('square', 'Square', 'Block', 'finance', 'Payments, orders and catalog.', 'https://mcp.squareup.com/sse', 'oauth', 'https://developer.squareup.com/docs/mcp', 'sse'),
  H('quickbooks', 'QuickBooks', 'Intuit', 'finance', 'Accounting data. Hosted connector.', 'https://developer.intuit.com/'),
  H('xero', 'Xero', 'Xero', 'finance', 'Accounting and invoices. Hosted connector.', 'https://developer.xero.com/'),
  H('ramp', 'Ramp', 'Ramp', 'finance', 'Spend, cards and approvals. Hosted connector.', 'https://docs.ramp.com/'),
  H('brex', 'Brex', 'Brex', 'finance', 'Cards and expenses. Hosted connector.', 'https://developer.brex.com/'),
  H('plaid', 'Plaid', 'Plaid', 'finance', 'Bank account data. Hosted connector.', 'https://plaid.com/docs/'),

  /* ----------------------------------- data ----------------------------------- */
  M('amplitude', 'Amplitude', 'Amplitude', 'analytics', 'Product analytics charts and cohorts.', 'https://mcp.amplitude.com/mcp', 'oauth', 'https://amplitude.com/docs'),
  M('mixpanel', 'Mixpanel', 'Mixpanel', 'analytics', 'Events, funnels and retention.', 'https://mcp.mixpanel.com/mcp', 'oauth', 'https://docs.mixpanel.com/'),
  M('hex', 'Hex', 'Hex', 'analytics', 'Notebooks, projects and data apps.', 'https://app.hex.tech/mcp', 'oauth', 'https://learn.hex.tech/docs'),
  H('posthog', 'PostHog', 'PostHog', 'analytics', 'Product analytics and session replay. Hosted connector.', 'https://posthog.com/docs/model-context-protocol'),
  H('datadog', 'Datadog', 'Datadog', 'monitoring', 'Metrics, logs and monitors. Hosted connector.', 'https://docs.datadoghq.com/'),
  H('grafana', 'Grafana', 'Grafana Labs', 'monitoring', 'Dashboards and alerts. Hosted connector.', 'https://grafana.com/docs/grafana/latest/'),
  H('honeycomb', 'Honeycomb', 'Honeycomb', 'monitoring', 'Traces and queries. Hosted connector.', 'https://docs.honeycomb.io/'),
  H('new-relic', 'New Relic', 'New Relic', 'monitoring', 'APM and alerts. Hosted connector.', 'https://docs.newrelic.com/'),
  H('dynatrace', 'Dynatrace', 'Dynatrace', 'monitoring', 'Observability data. Hosted connector.', 'https://docs.dynatrace.com/'),

  /* --------------------------------- cloud/devops --------------------------------- */
  M('cloudflare-docs', 'Cloudflare Developer Docs', 'Cloudflare', 'deployment', 'Search Cloudflare documentation from an agent.', 'https://docs.mcp.cloudflare.com/mcp', 'none', 'https://developers.cloudflare.com/agents/model-context-protocol/'),
  M('cloudflare-observability', 'Cloudflare Observability', 'Cloudflare', 'deployment', 'Logs and analytics for Cloudflare accounts.', 'https://observability.mcp.cloudflare.com/sse', 'oauth', 'https://developers.cloudflare.com/agents/model-context-protocol/', 'sse'),
  M('cloudflare-bindings', 'Cloudflare Bindings', 'Cloudflare', 'deployment', 'Workers KV, R2 and D1 bindings.', 'https://bindings.mcp.cloudflare.com/mcp', 'oauth', 'https://developers.cloudflare.com/agents/model-context-protocol/'),
  M('vercel', 'Vercel', 'Vercel', 'deployment', 'Projects, deployments and logs.', 'https://mcp.vercel.com', 'oauth', 'https://vercel.com/docs/mcp/vercel-mcp'),
  M('railway', 'Railway', 'Railway', 'deployment', 'Projects, services and deployments.', 'https://mcp.railway.com/mcp', 'oauth', 'https://docs.railway.com/'),
  M('render', 'Render', 'Render', 'deployment', 'Services, deploys and logs.', 'https://mcp.render.com/mcp', 'oauth', 'https://render.com/docs'),
  M('netlify', 'Netlify', 'Netlify', 'deployment', 'Sites, deploys and environment variables.', 'https://mcp.netlify.com/mcp', 'oauth', 'https://docs.netlify.com/'),
  M('heroku', 'Heroku', 'Salesforce', 'deployment', 'Apps, dynos and releases.', 'https://mcp.heroku.com/mcp', 'oauth', 'https://devcenter.heroku.com/'),
  M('wix', 'Wix', 'Wix', 'deployment', 'Sites, content and ecommerce.', 'https://mcp.wix.com/sse', 'oauth', 'https://dev.wix.com/docs', 'sse'),
  M('shopify', 'Shopify', 'Shopify', 'deployment', 'Store data and the Admin GraphQL API.', 'https://mcp.shopify.dev/mcp', 'oauth', 'https://shopify.dev/docs/apps/build/ai-toolkit'),
  H('aws', 'AWS', 'Amazon', 'deployment', 'AWS resources. Anthropic hosts an AWS connector; the AWS MCP servers run locally.', 'https://github.com/awslabs/mcp'),
  H('google-cloud', 'Google Cloud', 'Google', 'deployment', 'Google Cloud resources. Hosted connector.', 'https://cloud.google.com/'),
  H('azure', 'Microsoft Azure', 'Microsoft', 'deployment', 'Azure resources. Hosted connector.', 'https://learn.microsoft.com/azure/'),
  H('docker', 'Docker', 'Docker', 'deployment', 'Containers and the Docker MCP catalog gateway.', 'https://docs.docker.com/ai/mcp-catalog-and-toolkit/'),
  H('kubernetes', 'Kubernetes', 'CNCF', 'deployment', 'Cluster resources through local MCP servers.', 'https://kubernetes.io/docs/'),
  H('terraform', 'Terraform', 'HashiCorp', 'deployment', 'Infrastructure state and plans through the Terraform MCP server.', 'https://developer.hashicorp.com/terraform/mcp-server'),
  H('pulumi', 'Pulumi', 'Pulumi', 'deployment', 'Infrastructure as code. Hosted connector.', 'https://www.pulumi.com/docs/'),
  H('launchdarkly', 'LaunchDarkly', 'LaunchDarkly', 'deployment', 'Feature flags and experiments. Hosted connector.', 'https://launchdarkly.com/docs/'),

  /* ---------------------------------- design ---------------------------------- */
  M('figma', 'Figma', 'Figma', 'design', 'Design files, components and variables.', 'https://mcp.figma.com/mcp', 'oauth', 'https://developers.figma.com/docs/figma-mcp-server/'),
  H('adobe', 'Adobe Creative Cloud', 'Adobe', 'design', 'Creative Cloud assets. Hosted connector.', 'https://developer.adobe.com/'),
  H('framer', 'Framer', 'Framer', 'design', 'Sites and components. Hosted connector.', 'https://www.framer.com/developers/'),
  H('webflow', 'Webflow', 'Webflow', 'design', 'Sites and CMS collections. Hosted connector.', 'https://developers.webflow.com/'),
  H('wordpress', 'WordPress', 'Automattic', 'design', 'Posts, pages and media. Hosted connector.', 'https://developer.wordpress.com/'),

  /* ---------------------------------- commerce ---------------------------------- */
  H('amazon-seller', 'Amazon Seller', 'Amazon', 'commerce', 'Listings and orders. Hosted connector.', 'https://developer.amazonservices.com/'),
  H('etsy', 'Etsy', 'Etsy', 'commerce', 'Shop listings and orders. Hosted connector.', 'https://developers.etsy.com/'),
  H('ebay', 'eBay', 'eBay', 'commerce', 'Listings and orders. Hosted connector.', 'https://developer.ebay.com/'),
  H('bigcommerce', 'BigCommerce', 'BigCommerce', 'commerce', 'Catalog and orders. Hosted connector.', 'https://developer.bigcommerce.com/'),
  H('woocommerce', 'WooCommerce', 'Automattic', 'commerce', 'Store data. Hosted connector.', 'https://woocommerce.com/documentation/'),

  /* ---------------------------------- marketing ---------------------------------- */
  H('google-ads', 'Google Ads', 'Google', 'marketing', 'Campaign performance. Hosted connector.', 'https://developers.google.com/google-ads'),
  H('meta-ads', 'Meta Ads', 'Meta', 'marketing', 'Campaign performance. Hosted connector.', 'https://developers.facebook.com/docs/marketing-apis/'),
  H('linkedin-ads', 'LinkedIn Ads', 'Microsoft', 'marketing', 'Campaign performance. Hosted connector.', 'https://learn.microsoft.com/linkedin/marketing/'),
  H('tiktok-ads', 'TikTok Ads', 'ByteDance', 'marketing', 'Campaign performance. Hosted connector.', 'https://business-api.tiktok.com/portal/docs'),
  H('klaviyo', 'Klaviyo', 'Klaviyo', 'marketing', 'Email and SMS marketing. Hosted connector.', 'https://developers.klaviyo.com/'),
  H('mailchimp', 'Mailchimp', 'Intuit', 'marketing', 'Audiences and campaigns. Hosted connector.', 'https://mailchimp.com/developer/'),
  H('semrush', 'Semrush', 'Semrush', 'marketing', 'SEO and competitive data. Hosted connector.', 'https://developer.semrush.com/'),
  H('ahrefs', 'Ahrefs', 'Ahrefs', 'marketing', 'SEO and backlink data. Hosted connector.', 'https://docs.ahrefs.com/'),

  /* ---------------------------------- support ---------------------------------- */
  H('zendesk', 'Zendesk', 'Zendesk', 'support', 'Tickets and help-centre articles. Hosted connector.', 'https://developer.zendesk.com/'),
  H('freshdesk', 'Freshdesk', 'Freshworks', 'support', 'Tickets and contacts. Hosted connector.', 'https://developers.freshdesk.com/'),
  H('front', 'Front', 'Front', 'support', 'Shared inboxes. Hosted connector.', 'https://dev.frontapp.com/'),
  H('helpscout', 'Help Scout', 'Help Scout', 'support', 'Conversations and docs. Hosted connector.', 'https://developer.helpscout.com/'),

  /* ----------------------------------- sales ----------------------------------- */
  H('salesforce', 'Salesforce', 'Salesforce', 'sales', 'CRM records. Hosted connector plus a local Salesforce MCP server.', 'https://developer.salesforce.com/'),
  H('pipedrive', 'Pipedrive', 'Pipedrive', 'sales', 'Deals and contacts. Hosted connector.', 'https://developers.pipedrive.com/'),
  H('outreach', 'Outreach', 'Outreach', 'sales', 'Sequences and prospects. Hosted connector.', 'https://developers.outreach.io/'),
  H('salesloft', 'Salesloft', 'Salesloft', 'sales', 'Cadences and conversations. Hosted connector.', 'https://developers.salesloft.com/'),

  /* ----------------------------------- people ----------------------------------- */
  H('greenhouse', 'Greenhouse', 'Greenhouse', 'people', 'Candidates and jobs. Hosted connector.', 'https://developers.greenhouse.io/'),
  H('ashby', 'Ashby', 'Ashby', 'people', 'Recruiting pipeline. Hosted connector.', 'https://developers.ashbyhq.com/'),
  H('workday', 'Workday', 'Workday', 'people', 'HR and finance. Hosted connector.', 'https://community.workday.com/'),
  H('bamboohr', 'BambooHR', 'BambooHR', 'people', 'Employee records. Hosted connector.', 'https://documentation.bamboohr.com/'),
  H('gusto', 'Gusto', 'Gusto', 'people', 'Payroll and benefits. Hosted connector.', 'https://docs.gusto.com/'),
  H('deel', 'Deel', 'Deel', 'people', 'Global payroll and contracts. Hosted connector.', 'https://developer.deel.com/'),

  /* ----------------------------------- legal ----------------------------------- */
  H('docusign', 'DocuSign', 'DocuSign', 'legal', 'Envelopes and signatures. Hosted connector.', 'https://developers.docusign.com/'),
  H('ironclad', 'Ironclad', 'Ironclad', 'legal', 'Contract workflows. Hosted connector.', 'https://developer.ironcladapp.com/'),
  H('pandadoc', 'PandaDoc', 'PandaDoc', 'legal', 'Documents and templates. Hosted connector.', 'https://developers.pandadoc.com/'),
];

// Validate before writing: every MCP entry needs a sane HTTPS endpoint, and
// ids must be unique so settings can key servers by id.
const seen = new Set();
for (const c of connectors) {
  if (seen.has(c.id)) throw new Error(`Duplicate connector id: ${c.id}`);
  seen.add(c.id);
  if (c.kind === 'mcp') {
    const url = new URL(c.url);
    if (url.protocol !== 'https:') throw new Error(`Connector ${c.id} must use HTTPS`);
  }
  if (!/^https:\/\//.test(c.docs)) throw new Error(`Connector ${c.id} needs an https docs link`);
}

const existing = (await import('../catalog/connectors.json', { with: { type: 'json' } }).catch(() => ({ default: [] }))).default;
void existing;

await writeFile(
  fileURLToPath(new URL('../catalog/connectors.json', import.meta.url)),
  JSON.stringify(connectors, null, 2),
  'utf8',
);
console.log(`Wrote ${connectors.length} connectors (${connectors.filter((c) => c.kind === 'mcp').length} remote MCP, ${connectors.filter((c) => c.kind === 'hosted').length} hosted).`);
