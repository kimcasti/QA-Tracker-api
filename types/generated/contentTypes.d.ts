import type { Schema, Struct } from '@strapi/strapi';

export interface AdminApiToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_tokens';
  info: {
    description: '';
    displayName: 'Api Token';
    name: 'Api Token';
    pluralName: 'api-tokens';
    singularName: 'api-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    encryptedKey: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.Enumeration<['read-only', 'full-access', 'custom']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'read-only'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminApiTokenPermission extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_token_permissions';
  info: {
    description: '';
    displayName: 'API Token Permission';
    name: 'API Token Permission';
    pluralName: 'api-token-permissions';
    singularName: 'api-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminPermission extends Struct.CollectionTypeSchema {
  collectionName: 'admin_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'Permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    actionParameters: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    conditions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::permission'> &
      Schema.Attribute.Private;
    properties: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'admin::role'>;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminRole extends Struct.CollectionTypeSchema {
  collectionName: 'admin_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<'oneToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<'manyToMany', 'admin::user'>;
  };
}

export interface AdminSession extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_sessions';
  info: {
    description: 'Session Manager storage';
    displayName: 'Session';
    name: 'Session';
    pluralName: 'sessions';
    singularName: 'session';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    absoluteExpiresAt: Schema.Attribute.DateTime & Schema.Attribute.Private;
    childId: Schema.Attribute.String & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::session'> &
      Schema.Attribute.Private;
    origin: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique;
    status: Schema.Attribute.String & Schema.Attribute.Private;
    type: Schema.Attribute.String & Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_tokens';
  info: {
    description: '';
    displayName: 'Transfer Token';
    name: 'Transfer Token';
    pluralName: 'transfer-tokens';
    singularName: 'transfer-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferTokenPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_token_permissions';
  info: {
    description: '';
    displayName: 'Transfer Token Permission';
    name: 'Transfer Token Permission';
    pluralName: 'transfer-token-permissions';
    singularName: 'transfer-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::transfer-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminUser extends Struct.CollectionTypeSchema {
  collectionName: 'admin_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'User';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    blocked: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    firstname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    lastname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::user'> &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    preferedLanguage: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    roles: Schema.Attribute.Relation<'manyToMany', 'admin::role'> &
      Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String;
  };
}

export interface ApiBugBug extends Struct.CollectionTypeSchema {
  collectionName: 'bugs';
  info: {
    displayName: 'Bug';
    pluralName: 'bugs';
    singularName: 'bug';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    bugLink: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    detectedAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    evidenceImage: Schema.Attribute.Text;
    externalBugId: Schema.Attribute.String;
    functionality: Schema.Attribute.Relation<
      'manyToOne',
      'api::functionality.functionality'
    >;
    functionalityName: Schema.Attribute.String;
    internalBugId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    linkedSourceId: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::bug.bug'> &
      Schema.Attribute.Private;
    moduleName: Schema.Attribute.String;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    origin: Schema.Attribute.Enumeration<
      ['general_execution', 'regression_cycle', 'smoke_cycle']
    > &
      Schema.Attribute.DefaultTo<'general_execution'>;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    reportedBy: Schema.Attribute.String;
    severity: Schema.Attribute.Enumeration<
      ['critical', 'high', 'medium', 'low']
    >;
    sprint: Schema.Attribute.Relation<'manyToOne', 'api::sprint.sprint'>;
    status: Schema.Attribute.Enumeration<
      ['pending', 'in_progress', 'qa', 'resolved']
    > &
      Schema.Attribute.DefaultTo<'pending'>;
    testCase: Schema.Attribute.Relation<
      'manyToOne',
      'api::test-case.test-case'
    >;
    testCaseTitle: Schema.Attribute.String;
    testCycle: Schema.Attribute.Relation<
      'manyToOne',
      'api::test-cycle.test-cycle'
    >;
    testRun: Schema.Attribute.Relation<'manyToOne', 'api::test-run.test-run'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiFunctionalityFunctionality
  extends Struct.CollectionTypeSchema {
  collectionName: 'functionalities';
  info: {
    displayName: 'Functionality';
    pluralName: 'functionalities';
    singularName: 'functionality';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deliveryDate: Schema.Attribute.Date;
    isRegression: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isSmoke: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::functionality.functionality'
    > &
      Schema.Attribute.Private;
    module: Schema.Attribute.Relation<
      'manyToOne',
      'api::project-module.project-module'
    >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    personaRoles: Schema.Attribute.Relation<
      'manyToMany',
      'api::project-persona-role.project-persona-role'
    >;
    priority: Schema.Attribute.Enumeration<
      ['critical', 'high', 'medium', 'low']
    > &
      Schema.Attribute.DefaultTo<'medium'>;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    riskLevel: Schema.Attribute.Enumeration<['high', 'medium', 'low']> &
      Schema.Attribute.DefaultTo<'medium'>;
    sprint: Schema.Attribute.Relation<'manyToOne', 'api::sprint.sprint'>;
    status: Schema.Attribute.Enumeration<
      ['completed', 'failed', 'in_progress', 'backlog', 'mvp', 'post_mvp']
    > &
      Schema.Attribute.DefaultTo<'backlog'>;
    storyLegacyId: Schema.Attribute.String;
    testTypes: Schema.Attribute.JSON;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiMeetingNoteMeetingNote extends Struct.CollectionTypeSchema {
  collectionName: 'meeting_notes';
  info: {
    displayName: 'Meeting Note';
    pluralName: 'meeting-notes';
    singularName: 'meeting-note';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    aiActions: Schema.Attribute.Text;
    aiDecisions: Schema.Attribute.Text;
    aiNextSteps: Schema.Attribute.Text;
    aiSummary: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    date: Schema.Attribute.Date & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::meeting-note.meeting-note'
    > &
      Schema.Attribute.Private;
    notes: Schema.Attribute.Text & Schema.Attribute.Required;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    participants: Schema.Attribute.Text & Schema.Attribute.Required;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    time: Schema.Attribute.Time & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOrganizationInvitationOrganizationInvitation
  extends Struct.CollectionTypeSchema {
  collectionName: 'organization_invitations';
  info: {
    displayName: 'Organization Invitation';
    pluralName: 'organization-invitations';
    singularName: 'organization-invitation';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email & Schema.Attribute.Required;
    invitedAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    invitedBy: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization-invitation.organization-invitation'
    > &
      Schema.Attribute.Private;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    organizationRole: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization-role.organization-role'
    > &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['pending', 'accepted', 'expired', 'cancelled']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOrganizationMembershipOrganizationMembership
  extends Struct.CollectionTypeSchema {
  collectionName: 'organization_memberships';
  info: {
    displayName: 'Organization Membership';
    pluralName: 'organization-memberships';
    singularName: 'organization-membership';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization-membership.organization-membership'
    > &
      Schema.Attribute.Private;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    organizationRole: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization-role.organization-role'
    > &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Required;
  };
}

export interface ApiOrganizationRoleOrganizationRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'organization_roles';
  info: {
    displayName: 'Organization Role';
    pluralName: 'organization-roles';
    singularName: 'organization-role';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization-role.organization-role'
    > &
      Schema.Attribute.Private;
    memberships: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization-membership.organization-membership'
    >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOrganizationOrganization
  extends Struct.CollectionTypeSchema {
  collectionName: 'organizations';
  info: {
    displayName: 'Organization';
    pluralName: 'organizations';
    singularName: 'organization';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    invitations: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization-invitation.organization-invitation'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization.organization'
    > &
      Schema.Attribute.Private;
    meetingNotes: Schema.Attribute.Relation<
      'oneToMany',
      'api::meeting-note.meeting-note'
    >;
    memberships: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization-membership.organization-membership'
    >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    plan: Schema.Attribute.Enumeration<['starter', 'growth', 'enterprise']> &
      Schema.Attribute.DefaultTo<'starter'>;
    projects: Schema.Attribute.Relation<'oneToMany', 'api::project.project'>;
    publishedAt: Schema.Attribute.DateTime;
    roles: Schema.Attribute.Relation<
      'oneToMany',
      'api::organization-role.organization-role'
    >;
    slug: Schema.Attribute.UID<'name'> &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    status: Schema.Attribute.Enumeration<['active', 'inactive']> &
      Schema.Attribute.DefaultTo<'active'>;
    testPlans: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-plan.test-plan'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiProjectModuleProjectModule
  extends Struct.CollectionTypeSchema {
  collectionName: 'project_modules';
  info: {
    displayName: 'Project Module';
    pluralName: 'project-modules';
    singularName: 'project-module';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    functionalities: Schema.Attribute.Relation<
      'oneToMany',
      'api::functionality.functionality'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::project-module.project-module'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiProjectPersonaRoleProjectPersonaRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'project_persona_roles';
  info: {
    displayName: 'Project Persona Role';
    pluralName: 'project-persona-roles';
    singularName: 'project-persona-role';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    functionalities: Schema.Attribute.Relation<
      'manyToMany',
      'api::functionality.functionality'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::project-persona-role.project-persona-role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiProjectProject extends Struct.CollectionTypeSchema {
  collectionName: 'projects';
  info: {
    displayName: 'Project';
    pluralName: 'projects';
    singularName: 'project';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    bugs: Schema.Attribute.Relation<'oneToMany', 'api::bug.bug'>;
    businessRules: Schema.Attribute.Text;
    coreRequirements: Schema.Attribute.JSON;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    functionalities: Schema.Attribute.Relation<
      'oneToMany',
      'api::functionality.functionality'
    >;
    icon: Schema.Attribute.String;
    key: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::project.project'
    > &
      Schema.Attribute.Private;
    logoDataUrl: Schema.Attribute.Text;
    meetingNotes: Schema.Attribute.Relation<
      'oneToMany',
      'api::meeting-note.meeting-note'
    >;
    modules: Schema.Attribute.Relation<
      'oneToMany',
      'api::project-module.project-module'
    >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    personaRoles: Schema.Attribute.Relation<
      'oneToMany',
      'api::project-persona-role.project-persona-role'
    >;
    publishedAt: Schema.Attribute.DateTime;
    purpose: Schema.Attribute.Text;
    sprints: Schema.Attribute.Relation<'oneToMany', 'api::sprint.sprint'>;
    status: Schema.Attribute.Enumeration<['active', 'paused', 'completed']> &
      Schema.Attribute.DefaultTo<'active'>;
    teamMembers: Schema.Attribute.JSON;
    testCases: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-case.test-case'
    >;
    testCycles: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-cycle.test-cycle'
    >;
    testPlans: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-plan.test-plan'
    >;
    testRuns: Schema.Attribute.Relation<'oneToMany', 'api::test-run.test-run'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    version: Schema.Attribute.String;
  };
}

export interface ApiSprintSprint extends Struct.CollectionTypeSchema {
  collectionName: 'sprints';
  info: {
    displayName: 'Sprint';
    pluralName: 'sprints';
    singularName: 'sprint';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    endDate: Schema.Attribute.Date & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::sprint.sprint'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    objective: Schema.Attribute.Text;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    startDate: Schema.Attribute.Date & Schema.Attribute.Required;
    status: Schema.Attribute.Enumeration<
      ['planned', 'in_progress', 'completed']
    > &
      Schema.Attribute.DefaultTo<'planned'>;
    testPlans: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-plan.test-plan'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTestCaseTestCase extends Struct.CollectionTypeSchema {
  collectionName: 'test_cases';
  info: {
    displayName: 'Test Case';
    pluralName: 'test-cases';
    singularName: 'test-case';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    expectedResult: Schema.Attribute.Text;
    functionality: Schema.Attribute.Relation<
      'manyToOne',
      'api::functionality.functionality'
    > &
      Schema.Attribute.Required;
    isAutomated: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-case.test-case'
    > &
      Schema.Attribute.Private;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    preconditions: Schema.Attribute.Text;
    priority: Schema.Attribute.Enumeration<
      ['critical', 'high', 'medium', 'low']
    > &
      Schema.Attribute.DefaultTo<'medium'>;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    testSteps: Schema.Attribute.Text;
    testType: Schema.Attribute.Enumeration<
      [
        'integration',
        'functional',
        'sanity',
        'regression',
        'smoke',
        'exploratory',
        'uat',
      ]
    > &
      Schema.Attribute.DefaultTo<'functional'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTestCycleExecutionTestCycleExecution
  extends Struct.CollectionTypeSchema {
  collectionName: 'test_cycle_executions';
  info: {
    displayName: 'Test Cycle Execution';
    pluralName: 'test-cycle-executions';
    singularName: 'test-cycle-execution';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    bug: Schema.Attribute.Relation<'manyToOne', 'api::bug.bug'>;
    bugLink: Schema.Attribute.String;
    bugTitle: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    date: Schema.Attribute.Date;
    evidence: Schema.Attribute.Text;
    evidenceImage: Schema.Attribute.Text;
    executed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    functionality: Schema.Attribute.Relation<
      'manyToOne',
      'api::functionality.functionality'
    >;
    functionalityName: Schema.Attribute.String;
    linkedBugId: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-cycle-execution.test-cycle-execution'
    > &
      Schema.Attribute.Private;
    moduleName: Schema.Attribute.String;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    result: Schema.Attribute.Enumeration<
      ['passed', 'failed', 'blocked', 'not_executed']
    > &
      Schema.Attribute.DefaultTo<'not_executed'>;
    severity: Schema.Attribute.Enumeration<
      ['critical', 'high', 'medium', 'low']
    >;
    testCase: Schema.Attribute.Relation<
      'manyToOne',
      'api::test-case.test-case'
    >;
    testCaseTitle: Schema.Attribute.String;
    testCycle: Schema.Attribute.Relation<
      'manyToOne',
      'api::test-cycle.test-cycle'
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTestCycleTestCycle extends Struct.CollectionTypeSchema {
  collectionName: 'test_cycles';
  info: {
    displayName: 'Test Cycle';
    pluralName: 'test-cycles';
    singularName: 'test-cycle';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    blocked: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    buildVersion: Schema.Attribute.String;
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    cycleType: Schema.Attribute.Enumeration<['regression', 'smoke']> &
      Schema.Attribute.Required;
    date: Schema.Attribute.Date & Schema.Attribute.Required;
    environment: Schema.Attribute.Enumeration<['test', 'local', 'production']>;
    executions: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-cycle-execution.test-cycle-execution'
    >;
    failed: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-cycle.test-cycle'
    > &
      Schema.Attribute.Private;
    note: Schema.Attribute.Text;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    passed: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    passRate: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    pending: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    sprint: Schema.Attribute.Relation<'manyToOne', 'api::sprint.sprint'>;
    status: Schema.Attribute.Enumeration<['completed', 'in_progress']> &
      Schema.Attribute.DefaultTo<'in_progress'>;
    tester: Schema.Attribute.String;
    totalTests: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTestPlanTestPlan extends Struct.CollectionTypeSchema {
  collectionName: 'test_plans';
  info: {
    displayName: 'Test Plan';
    pluralName: 'test-plans';
    singularName: 'test-plan';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    date: Schema.Attribute.Date & Schema.Attribute.Required;
    description: Schema.Attribute.Text;
    impactModules: Schema.Attribute.JSON;
    jiraId: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-plan.test-plan'
    > &
      Schema.Attribute.Private;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    priority: Schema.Attribute.Enumeration<
      ['critical', 'high', 'medium', 'low']
    > &
      Schema.Attribute.DefaultTo<'medium'>;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    scope: Schema.Attribute.Enumeration<['total', 'partial']> &
      Schema.Attribute.DefaultTo<'total'>;
    sprint: Schema.Attribute.Relation<'manyToOne', 'api::sprint.sprint'>;
    testType: Schema.Attribute.Enumeration<
      [
        'integration',
        'functional',
        'sanity',
        'regression',
        'smoke',
        'exploratory',
        'uat',
      ]
    > &
      Schema.Attribute.DefaultTo<'regression'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTestRunResultTestRunResult
  extends Struct.CollectionTypeSchema {
  collectionName: 'test_run_results';
  info: {
    displayName: 'Test Run Result';
    pluralName: 'test-run-results';
    singularName: 'test-run-result';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    bug: Schema.Attribute.Relation<'manyToOne', 'api::bug.bug'>;
    bugLink: Schema.Attribute.String;
    bugTitle: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    evidenceImage: Schema.Attribute.Text;
    functionality: Schema.Attribute.Relation<
      'manyToOne',
      'api::functionality.functionality'
    >;
    linkedBugId: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-run-result.test-run-result'
    > &
      Schema.Attribute.Private;
    notes: Schema.Attribute.Text;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    result: Schema.Attribute.Enumeration<
      ['passed', 'failed', 'blocked', 'not_executed']
    > &
      Schema.Attribute.DefaultTo<'not_executed'>;
    severity: Schema.Attribute.Enumeration<
      ['critical', 'high', 'medium', 'low']
    >;
    testCase: Schema.Attribute.Relation<
      'manyToOne',
      'api::test-case.test-case'
    >;
    testRun: Schema.Attribute.Relation<'manyToOne', 'api::test-run.test-run'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTestRunTestRun extends Struct.CollectionTypeSchema {
  collectionName: 'test_runs';
  info: {
    displayName: 'Test Run';
    pluralName: 'test-runs';
    singularName: 'test-run';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    buildVersion: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    environment: Schema.Attribute.Enumeration<['test', 'local', 'production']>;
    executionDate: Schema.Attribute.Date;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-run.test-run'
    > &
      Schema.Attribute.Private;
    organization: Schema.Attribute.Relation<
      'manyToOne',
      'api::organization.organization'
    > &
      Schema.Attribute.Required;
    priority: Schema.Attribute.Enumeration<
      ['critical', 'high', 'medium', 'low']
    > &
      Schema.Attribute.DefaultTo<'medium'>;
    project: Schema.Attribute.Relation<'manyToOne', 'api::project.project'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    results: Schema.Attribute.Relation<
      'oneToMany',
      'api::test-run-result.test-run-result'
    >;
    selectedFunctionalities: Schema.Attribute.JSON;
    selectedModules: Schema.Attribute.JSON;
    sprint: Schema.Attribute.Relation<'manyToOne', 'api::sprint.sprint'>;
    status: Schema.Attribute.Enumeration<['draft', 'final']> &
      Schema.Attribute.DefaultTo<'draft'>;
    tester: Schema.Attribute.String;
    testType: Schema.Attribute.Enumeration<
      [
        'integration',
        'functional',
        'sanity',
        'regression',
        'smoke',
        'exploratory',
        'uat',
      ]
    > &
      Schema.Attribute.DefaultTo<'functional'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesRelease
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_releases';
  info: {
    displayName: 'Release';
    pluralName: 'releases';
    singularName: 'release';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    actions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['ready', 'blocked', 'failed', 'done', 'empty']
    > &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesReleaseAction
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_release_actions';
  info: {
    displayName: 'Release Action';
    pluralName: 'release-actions';
    singularName: 'release-action';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentType: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entryDocumentId: Schema.Attribute.String;
    isEntryValid: Schema.Attribute.Boolean;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    release: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::content-releases.release'
    >;
    type: Schema.Attribute.Enumeration<['publish', 'unpublish']> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginI18NLocale extends Struct.CollectionTypeSchema {
  collectionName: 'i18n_locale';
  info: {
    collectionName: 'locales';
    description: '';
    displayName: 'Locale';
    pluralName: 'locales';
    singularName: 'locale';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::i18n.locale'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 1;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflow
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows';
  info: {
    description: '';
    displayName: 'Workflow';
    name: 'Workflow';
    pluralName: 'workflows';
    singularName: 'workflow';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentTypes: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'[]'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    stageRequiredToPublish: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::review-workflows.workflow-stage'
    >;
    stages: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflowStage
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows_stages';
  info: {
    description: '';
    displayName: 'Stages';
    name: 'Workflow Stage';
    pluralName: 'workflow-stages';
    singularName: 'workflow-stage';
  };
  options: {
    draftAndPublish: false;
    version: '1.1.0';
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#4945FF'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String;
    permissions: Schema.Attribute.Relation<'manyToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflow: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::review-workflows.workflow'
    >;
  };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: 'files';
  info: {
    description: '';
    displayName: 'File';
    pluralName: 'files';
    singularName: 'file';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    alternativeText: Schema.Attribute.Text;
    caption: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ext: Schema.Attribute.String;
    focalPoint: Schema.Attribute.JSON;
    folder: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'> &
      Schema.Attribute.Private;
    folderPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    height: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.file'
    > &
      Schema.Attribute.Private;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.Text;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    related: Schema.Attribute.Relation<'morphToMany'>;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.Text & Schema.Attribute.Required;
    width: Schema.Attribute.Integer;
  };
}

export interface PluginUploadFolder extends Struct.CollectionTypeSchema {
  collectionName: 'upload_folders';
  info: {
    displayName: 'Folder';
    pluralName: 'folders';
    singularName: 'folder';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.folder'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    files: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.file'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    parent: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'>;
    path: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    pathId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginUsersPermissionsUser
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'user';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
    timestamps: true;
  };
  attributes: {
    blocked: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    confirmationToken: Schema.Attribute.String & Schema.Attribute.Private;
    confirmed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    provider: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ContentTypeSchemas {
      'admin::api-token': AdminApiToken;
      'admin::api-token-permission': AdminApiTokenPermission;
      'admin::permission': AdminPermission;
      'admin::role': AdminRole;
      'admin::session': AdminSession;
      'admin::transfer-token': AdminTransferToken;
      'admin::transfer-token-permission': AdminTransferTokenPermission;
      'admin::user': AdminUser;
      'api::bug.bug': ApiBugBug;
      'api::functionality.functionality': ApiFunctionalityFunctionality;
      'api::meeting-note.meeting-note': ApiMeetingNoteMeetingNote;
      'api::organization-invitation.organization-invitation': ApiOrganizationInvitationOrganizationInvitation;
      'api::organization-membership.organization-membership': ApiOrganizationMembershipOrganizationMembership;
      'api::organization-role.organization-role': ApiOrganizationRoleOrganizationRole;
      'api::organization.organization': ApiOrganizationOrganization;
      'api::project-module.project-module': ApiProjectModuleProjectModule;
      'api::project-persona-role.project-persona-role': ApiProjectPersonaRoleProjectPersonaRole;
      'api::project.project': ApiProjectProject;
      'api::sprint.sprint': ApiSprintSprint;
      'api::test-case.test-case': ApiTestCaseTestCase;
      'api::test-cycle-execution.test-cycle-execution': ApiTestCycleExecutionTestCycleExecution;
      'api::test-cycle.test-cycle': ApiTestCycleTestCycle;
      'api::test-plan.test-plan': ApiTestPlanTestPlan;
      'api::test-run-result.test-run-result': ApiTestRunResultTestRunResult;
      'api::test-run.test-run': ApiTestRunTestRun;
      'plugin::content-releases.release': PluginContentReleasesRelease;
      'plugin::content-releases.release-action': PluginContentReleasesReleaseAction;
      'plugin::i18n.locale': PluginI18NLocale;
      'plugin::review-workflows.workflow': PluginReviewWorkflowsWorkflow;
      'plugin::review-workflows.workflow-stage': PluginReviewWorkflowsWorkflowStage;
      'plugin::upload.file': PluginUploadFile;
      'plugin::upload.folder': PluginUploadFolder;
      'plugin::users-permissions.permission': PluginUsersPermissionsPermission;
      'plugin::users-permissions.role': PluginUsersPermissionsRole;
      'plugin::users-permissions.user': PluginUsersPermissionsUser;
    }
  }
}
