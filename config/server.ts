import type { Core } from '@strapi/strapi';
import { runJiraPersonalDataReport } from '../src/utils/jira-personal-data-report';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: env.bool('JIRA_PRIVACY_REPORTING_ENABLED', false),
    tasks: {
      'jira-personal-data-report': {
        task: async ({ strapi }) => {
          const summary = await runJiraPersonalDataReport({ strapi });
          strapi.log.info(
            `Jira privacy report completed: reported=${summary.reported}, refreshed=${summary.refreshed}, disconnected=${summary.disconnected}.`,
          );
        },
        // Run daily away from the top of the hour; each account is only reported when due.
        options: { rule: '17 3 * * *', tz: 'UTC' },
      },
    },
  },
});

export default config;
