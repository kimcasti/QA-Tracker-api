import { compileStrapi, createStrapi } from '@strapi/strapi';
import { runJiraPersonalDataReport } from '../utils/jira-personal-data-report';

async function main() {
  if (process.env.JIRA_PRIVACY_REPORTING_ENABLED !== 'true') {
    throw new Error('Set JIRA_PRIVACY_REPORTING_ENABLED=true before running this command.');
  }

  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();

  try {
    const summary = await runJiraPersonalDataReport({ strapi });
    strapi.log.info(
      `Jira privacy report completed: reported=${summary.reported}, refreshed=${summary.refreshed}, disconnected=${summary.disconnected}.`,
    );
  } finally {
    await strapi.destroy();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
