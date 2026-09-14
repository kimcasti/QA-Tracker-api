import { errors } from '@strapi/utils';
import { isActiveConnection, readConnection } from '../utils/automation-connection';
import { findAccessibleProject } from '../api/automation-ingestion/controllers/automation-ingestion';

export default async (ctx: any) => {
  const connection = await readConnection(ctx);
  if (!isActiveConnection(connection)) throw new errors.UnauthorizedError('Autoriza primero la conexión.');
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: connection.userId } });
  if (!user || user.blocked || !user.confirmed) throw new errors.UnauthorizedError('Cuenta no disponible.');
  await findAccessibleProject(user.id, { projectDocumentId: connection.projectId });
  ctx.state.user = user;
  ctx.state.automationConnection = connection;
  return true;
};
