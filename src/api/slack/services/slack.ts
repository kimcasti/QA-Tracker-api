import { errors } from '@strapi/utils';

type SlackUsersListMember = {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    real_name?: string;
    display_name?: string;
    display_name_normalized?: string;
    image_24?: string;
    image_32?: string;
    image_48?: string;
    image_72?: string;
    image_192?: string;
    email?: string;
    title?: string;
  };
};

type SlackUsersListResponse = {
  ok: boolean;
  error?: string;
  members?: SlackUsersListMember[];
  response_metadata?: {
    next_cursor?: string;
  };
};

function getSlackToken() {
  return process.env.SLACK_BOT_TOKEN?.trim() || process.env.SLACK_TOKEN?.trim() || '';
}

function normalizeMember(member: SlackUsersListMember) {
  const profile = member.profile || {};
  const realName = profile.real_name?.trim() || '';
  const displayName =
    profile.display_name?.trim() || profile.display_name_normalized?.trim() || '';
  const username = member.name?.trim() || '';
  const fullName = realName || displayName || username;

  return {
    id: member.id,
    username,
    realName,
    displayName,
    fullName,
    email: profile.email?.trim() || undefined,
    title: profile.title?.trim() || undefined,
    avatarUrl:
      profile.image_72 ||
      profile.image_48 ||
      profile.image_32 ||
      profile.image_24 ||
      profile.image_192 ||
      undefined,
  };
}

export default () => ({
  async members() {
    const slackToken = getSlackToken();

    if (!slackToken) {
      throw new errors.ApplicationError(
        'Slack integration is not configured. Set SLACK_BOT_TOKEN in the API environment.',
      );
    }

    const members: SlackUsersListMember[] = [];
    let cursor = '';

    try {
      do {
        const params = new URLSearchParams({
          limit: '200',
        });

        if (cursor) {
          params.set('cursor', cursor);
        }

        const response = await fetch(`https://slack.com/api/users.list?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${slackToken}`,
          },
        });

        if (!response.ok) {
          throw new errors.ApplicationError(
            `Slack request failed with status ${response.status}.`,
          );
        }

        const payload = (await response.json()) as SlackUsersListResponse;

        if (!payload.ok) {
          throw new errors.ApplicationError(
            `Slack users.list returned an error: ${payload.error || 'unknown_error'}.`,
          );
        }

        members.push(...(payload.members || []));
        cursor = payload.response_metadata?.next_cursor?.trim() || '';
      } while (cursor);

      return members
        .filter(member => !member.deleted && !member.is_bot && member.id !== 'USLACKBOT')
        .map(normalizeMember)
        .filter(member => Boolean(member.fullName))
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
    } catch (error) {
      strapi.log.error('Failed to fetch Slack members.', error);

      if (error instanceof errors.ApplicationError) {
        throw error;
      }

      throw new errors.ApplicationError('Error fetching team members from Slack.');
    }
  },
});
