export interface TestResult {
  id: string;
  uuid?: string;
  historyId?: string;
  allureId?: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'broken';
  startTime: string;
  endTime?: string;
  duration?: number;
  totalAttachments?: number;
  labels?: TestResultLabel[];
  diagnostics?: TestResultDiagnostics;
  history?: TestResultHistoryItem[];
  retries?: TestResultHistoryItem[];
  parameters?: Record<string, any> | Array<{ name?: string; value?: any; [key: string]: any }>;
  steps?: TestStep[];
  testRun?: TestRun;
}

export interface TestResultLabel {
  name: string;
  value: string;
}

export interface TestResultDiagnostics {
  status: string;
  failedStepName?: string | null;
  message?: string | null;
  stackTrace?: string | null;
  hasAttachments?: boolean;
}

export interface TestResultHistoryItem {
  id: string;
  uuid?: string;
  status: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  testRunId?: string;
}

export interface TestResultsMeta {
  runId: string;
  generatedAt: string;
  totalResults: number;
  passedCount?: number;
  failedCount: number;
  brokenCount: number;
  skippedCount?: number;
  totalAttachments: number;
}

export interface TestResultsResponse {
  items: TestResult[];
  total: number;
  meta?: TestResultsMeta;
}

export interface TestRunStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  broken: number;
  passRate: number;
}

export interface TestSummaryStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
}

export interface TestStep {
  id: string;
  name: string;
  status: string;
  stage: string;
  // Keep the old properties for backward compatibility
  start?: Date;
  stop?: Date;
  // New properties that match the backend entity
  startTime?: string;
  endTime?: string;
  statusDetails?: any;
  parameters?: Record<string, any> | Array<{ name?: string; value?: any; [key: string]: any }>;
  childSteps?: TestStep[];
  attachments?: TestAttachment[];
  stepAttachments?: TestAttachment[];
}

export interface TestRun {
  id: string | number;
  uuid?: string;
  name: string;
  projectId?: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed' | string;
  tags?: string[];
  environment?: string | null;
  branch?: string | null;
  stats?: TestRunStats;
  // Removed results property since it's no longer available from the backend
}

export interface TestAttachment {
  id: string;
  name: string;
  type: string;
  source: string;
  content?: any;
  isTrace?: boolean;
  traceViewerUrl?: string;
  traceAssetUrl?: string;
  traceTokenExpiresAt?: string;
}

export interface TestArtifact {
  id: string;
  name: string;
  type: 'trace' | 'screenshot' | 'video' | 'log';
  path: string;
  uploadedAt: Date;
}

export type ProjectLifecycleStatus = 'active' | 'archived';

export interface ProjectSummary {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isDefault: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveProjectState {
  activeProjectId: string;
  activeProject?: ProjectSummary;
  projects: ProjectSummary[];
}

export type ProjectRole = 'owner' | 'maintainer' | 'viewer';

export interface ProjectMembership {
  userId: number;
  userName: string;
  userEmail: string;
  projectId: string;
  projectName: string;
  projectRole: ProjectRole;
  createdAt: string;
  updatedAt: string;
}

export interface UserProjectAccess {
  userId: number;
  userName: string;
  userEmail: string;
  platformRole: 'admin' | 'user';
  memberships: Array<{
    projectId: string;
    projectName: string;
    projectRole: ProjectRole;
    isArchived: boolean;
  }>;
}

export type DashboardVisualizationType = 'stat' | 'line' | 'bar' | 'area' | 'pie' | 'table';

export type DashboardDataSourceType =
  | 'test-summary'
  | 'test-trend'
  | 'recent-runs'
  | 'pass-rate'
  | 'latest-run-status'
  | 'pass-fail-trend'
  | 'flaky-rate'
  | 'top-failing-tests'
  | 'top-failing-suites';

export interface DashboardMetaOption {
  id: string;
  label: string;
}

export interface DashboardMeta {
  visualizations: DashboardMetaOption[];
  dataSources: DashboardMetaOption[];
}

export interface DashboardWidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardWidget {
  id: string;
  title: string;
  visualization: DashboardVisualizationType;
  dataSource: DashboardDataSourceType | string;
  layout?: DashboardWidgetLayout;
  options?: Record<string, unknown>;
}

export interface DashboardConfig {
  id: string;
  name: string;
  isDefault: boolean;
  order: number;
  widgets: DashboardWidget[];
  updatedAt: string;
}

export interface DashboardState {
  dashboards: DashboardConfig[];
}

export interface DashboardMetricsFilters {
  dateFrom?: string;
  dateTo?: string;
  branch?: string;
  environment?: string;
  tags?: string | string[];
  status?: string;
}

export interface DashboardPassFailTrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
  broken: number;
  total: number;
}

export interface DashboardFlakyRate {
  percentage: number;
  flakyTests: number;
  trackedTests: number;
}

export interface DashboardTopFailingTest {
  name: string;
  failures: number;
  flakyRuns: number;
  lastStatus: string;
  lastRunAt?: string;
}

export interface DashboardTopFailingSuite {
  name: string;
  failures: number;
  tests: number;
}

export interface DashboardMetricsSummary {
  totalRuns: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  broken: number;
  passRate: number;
}

export interface DashboardMetricsCacheMeta {
  key: string;
  hit: boolean;
  generatedAt: string;
  expiresAt: string;
  ttlSeconds: number;
}

export type DashboardMetricsCache = DashboardMetricsCacheMeta;

export interface DashboardMetricsResponse {
  filters: DashboardMetricsFilters;
  summary: DashboardMetricsSummary;
  passFailTrend: DashboardPassFailTrendPoint[];
  flakyRate: DashboardFlakyRate;
  topFailingTests: DashboardTopFailingTest[];
  topFailingSuites: DashboardTopFailingSuite[];
  cache?: DashboardMetricsCacheMeta;
}

// --- Test Coverage Intelligence types ---

export type CoverageUnitType = 'api_endpoint' | 'ui_flow' | 'domain_operation';

export interface CoverageUnit {
  unitId: string;
  unitType: CoverageUnitType;
  moduleKey: string;
  displayName: string;
  owner?: string;
  isCritical: boolean;
}

export interface CoverageEvidence {
  unitId: string;
  codePresence: number;
  testPresence: number;
  executionFreshness: number;
  executionStability: number;
  assertionDepth: number;
  incidentLink: number;
}

export interface CoverageScoreBreakdown {
  unitId: string;
  displayName: string;
  moduleKey: string;
  effectiveCoverage: number;
  riskWeight: number;
  unitConfidence: number;
  evidence: CoverageEvidence;
}

export interface CoverageModuleBreakdown {
  moduleKey: string;
  coverageScore: number;
  unitCount: number;
  coveredUnits: number;
  averageConfidence: number;
}

export interface CoverageGap {
  unitId: string;
  displayName: string;
  moduleKey: string;
  effectiveCoverage: number;
  riskWeight: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
}

export interface TestCoverageSummary {
  projectCoverageScore: number;
  totalUnits: number;
  coveredUnits: number;
  projectConfidence: number;
  confidenceBand: 'high' | 'medium' | 'low';
  generatedAt: string;
}

export interface CoverageRecommendation {
  recommendationId: string;
  projectId: string;
  unitId: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  riskReason: string;
  coverageReason: string;
  suggestedScenario: {
    title: string;
    given: string[];
    when: string[];
    then: string[];
  };
  estimatedImpact: {
    coverageDelta: number;
    confidenceDelta: number;
  };
  confidence: number;
}

export interface CoverageInventoryResponse {
  projectId: string;
  totalUnits: number;
  units: Array<CoverageUnit & { evidence: CoverageEvidence }>;
  generatedAt: string;
}

// --- LLM Connection Settings types ---

export type LlmProvider = 'openai' | 'anthropic' | 'google' | 'azure' | 'local' | 'ollama' | 'lmstudio' | 'custom';

export interface LlmAnalysisScope {
  summarizeFailedTests: boolean;
  suggestRootCauses: boolean;
  generateRemediation: boolean;
  flakyTestAnalysis: boolean;
}

export interface LlmConnectionSettings {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  endpointUrl: string;
  analysisScope: LlmAnalysisScope;
}

// --- Connector Settings types ---

export interface ConnectorConfig {
  enabled: boolean;
  endpointUrl: string;
  apiKey: string;
}

export interface ConnectorSettings {
  kibana: ConnectorConfig;
  sentry: ConnectorConfig;
  grafana: ConnectorConfig;
  logs: ConnectorConfig;
}

export interface ConnectorInstance {
  id: string;
  type: string;
  name: string;
  endpointUrl: string;
  apiKey: string;
  timeoutMs: number;
  enabled: boolean;
}

export interface ConnectorTypeInfo {
  type: string;
  label: string;
  description: string;
}

export type AiAnalysisConnectorType =
  | 'repository'
  | 'kibana'
  | 'logs'
  | 'trace'
  | 'history';

export interface AiAnalysisBoundaryContract {
  id: string;
  owner: 'core-platform' | 'ai-module';
  responsibilities: string[];
  inputContracts: string[];
  outputContracts: string[];
}

export interface AiAnalysisConnectorContract {
  type: AiAnalysisConnectorType;
  enabled: boolean;
  configurationKey: string;
  notes: string;
}

export interface AiAnalysisRepositoryContext {
  id: string;
  name: string;
  url: string;
}

export interface AiFailureAnalysisRequestContract {
  runId: number;
  resultId: string;
  includeHistory: boolean;
  includeTrace: boolean;
  includeLogs: boolean;
  repositoryIds: string[];
}

export interface AiFailureAnalysisEvidenceItemContract {
  source: AiAnalysisConnectorType;
  title: string;
  uri: string;
  relevanceScore: number;
}

export interface AiFailureAnalysisResponseContract {
  summary: string;
  likelyRootCauses: string[];
  confidence: number;
  evidence: AiFailureAnalysisEvidenceItemContract[];
  generatedAt: string;
}

export interface AiFailureAnalysisRequest {
  runId: number;
  resultId: string;
  failureMessage?: string;
  stackTrace?: string;
  includeHistory?: boolean;
  includeTrace?: boolean;
  includeLogs?: boolean;
  repositoryIds?: string[];
  topK?: number;
}

export interface AiFailureAnalysisResponse {
  summary: string;
  likelyRootCauses: string[];
  confidence: number;
  evidence: AiFailureAnalysisEvidenceItemContract[];
  generatedAt: string;
  warnings: string[];
  model: string;
  isFlaky?: boolean;
}

export interface AiAnalysisChatMessage {
  id: number;
  testResultId: string;
  testRunId: number;
  role: 'user' | 'assistant';
  content: string;
  authorName: string | null;
  createdAt: string;
}

export interface AiAnalysisContractsResponse {
  version: string;
  generatedAt: string;
  status: 'draft' | 'active';
  boundaries: AiAnalysisBoundaryContract[];
  connectors: AiAnalysisConnectorContract[];
  requestContract: AiFailureAnalysisRequestContract;
  responseContract: AiFailureAnalysisResponseContract;
  repositoryContexts: AiAnalysisRepositoryContext[];
}

export type AiAnalysisEditionMode = 'oss_stub' | 'pro_self_hosted';

export interface AiAnalysisFeatureAvailability {
  enabled: boolean;
  reason?: string;
}

export interface AiAnalysisCapabilitiesFeatures {
  analysis: AiAnalysisFeatureAvailability;
  indexing: AiAnalysisFeatureAvailability;
  retrieval: AiAnalysisFeatureAvailability;
  kibanaConnector: AiAnalysisFeatureAvailability;
  sentryConnector: AiAnalysisFeatureAvailability;
  grafanaConnector: AiAnalysisFeatureAvailability;
}

export interface AiAnalysisLicenseSummary {
  licenseId: string;
  customer: string;
  issuedAt: string;
  expiresAt: string | null;
}

export interface AiAnalysisCapabilitiesResponse {
  mode: AiAnalysisEditionMode;
  status: 'stub' | 'licensed' | 'invalid' | 'expired';
  licensed: boolean;
  upgradeUrl: string | null;
  message: string;
  features: AiAnalysisCapabilitiesFeatures;
  license: AiAnalysisLicenseSummary | null;
}

export interface AiRepositoryIndexRequest {
  repositoryIds?: string[];
  chunkSizeChars?: number;
  chunkOverlapChars?: number;
  maxFileSizeBytes?: number;
}

export interface AiRepositoryIndexResult {
  repositoryId: string;
  repositoryName: string;
  status: 'indexed' | 'skipped';
  sourcePath?: string;
  indexedFiles: number;
  skippedFiles: number;
  chunkCount: number;
  errors: string[];
}

export interface AiRepositoryIndexChunkMeta {
  repositoryId: string;
  repositoryName: string;
  filePath: string;
  chunkIndex: number;
  charCount: number;
  sha1: string;
  chunkId?: string;
  language?: string;
  pathTokens?: string[];
  symbolHints?: string[];
}

export interface AiRepositoryIndexCatalog {
  generatedAt: string;
  monorepoRoot: string;
  config: {
    chunkSizeChars: number;
    chunkOverlapChars: number;
    maxFileSizeBytes: number;
    repositoryIds: string[] | null;
    fileExtensions: string[];
    ignoredDirectories: string[];
  };
  repositories: AiRepositoryIndexResult[];
  chunks: AiRepositoryIndexChunkMeta[];
}

export interface AiRepositoryIndexResponse {
  status: 'ready' | 'partial' | 'empty';
  generatedAt: string;
  repositories: AiRepositoryIndexResult[];
  totalChunks: number;
  totalIndexedFiles: number;
  totalSkippedFiles: number;
  catalogKey: string;
  warnings: string[];
}

export interface AiEvidenceRetrievalRequest {
  query: string;
  repositoryIds?: string[];
  filePathPrefixes?: string[];
  pathHints?: string[];
  symbolHints?: string[];
  topK?: number;
  minScore?: number;
}

export interface AiEvidenceRetrievalItem {
  repositoryId: string;
  repositoryName: string;
  filePath: string;
  chunkIndex: number;
  sourceUri: string;
  relevanceScore: number;
  snippet: string;
  rankingReasons?: string[];
  scoreBreakdown?: {
    lexical: number;
    vector: number;
    pathBoost: number;
    symbolBoost: number;
    final: number;
  };
}

export interface AiEvidenceRetrievalResponse {
  status: 'ready' | 'empty';
  generatedAt: string;
  vectorProvider: string;
  fallbackUsed: boolean;
  totalCandidates: number;
  totalMatches: number;
  items: AiEvidenceRetrievalItem[];
  warnings: string[];
}

export type AiEvidenceConnectorType = 'kibana' | 'sentry' | 'grafana' | 'logs';

export interface AiEvidenceConnectorConfig {
  id: string;
  type: string;
  name: string;
  endpointUrl: string;
  enabled: boolean;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface AiConnectorTestRequest {
  type: string;
  endpointUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface AiConnectorTestResponse {
  connectorType: string;
  status: 'ok' | 'invalid' | 'disabled' | 'error' | 'timeout' | 'auth_failed';
  checkedAt: string;
  message: string;
  normalizedEndpoint: string | null;
  responseTimeMs: number;
  warnings: string[];
}

export type RepositorySourceType =
  | 'local'
  | 'network'
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'azure-devops';

export type NotificationDestinationType =
  | 'slack'
  | 'telegram'
  | 'email'
  | 'webhook';
export type NotificationEventType = 'test-run.completed' | 'test-run.failed';
export type NotificationMessageMode = 'summary' | 'failures' | 'summary+failures';
export type NotificationDeliveryMode = 'summary' | 'per-test';

export interface NotificationDestination {
  id: string;
  name: string;
  type: NotificationDestinationType;
  channel: string;
  webhookUrl: string;
  enabled: boolean;
}

export interface NotificationRules {
  enabled: boolean;
  events: NotificationEventType[];
  deliveryMode: NotificationDeliveryMode;
  deliveryDelaySeconds: number;
  sendWhenFailedOnly: boolean;
  messageMode: NotificationMessageMode;
  sendCompletionNotice: boolean;
}

export interface NotificationTemplates {
  summary: string;
  failure: string;
}

export interface NotificationSettings {
  projectId: string;
  destinations: NotificationDestination[];
  rules: NotificationRules;
  templates: NotificationTemplates;
}

export interface NotificationContract {
  version: string;
  generatedAt: string;
  persistenceKeys: {
    destinations: string;
    rules: string;
    templates: string;
  };
  events: NotificationEventType[];
  destinationTypes: NotificationDestinationType[];
  messageModes: NotificationMessageMode[];
  deliveryModes: NotificationDeliveryMode[];
  defaults: {
    rules: NotificationRules;
    templates: NotificationTemplates;
  };
}

export interface NotificationDispatchResult {
  destinationId: string;
  destinationType: NotificationDestinationType;
  status: 'sent' | 'failed' | 'skipped';
  attempt: number;
  responseCode?: number;
  error?: string;
  dedupeKey: string;
}

export interface NotificationTestDispatchResponse {
  sent: number;
  failed: number;
  skipped: number;
  results: NotificationDispatchResult[];
}

export interface NotificationHistoryItem {
  id: string;
  createdAt: string;
  deliveredAt?: string;
  projectId: string;
  event: NotificationEventType;
  destinationId: string;
  destinationType: NotificationDestinationType;
  status: 'sent' | 'failed' | 'skipped';
  attempt: number;
  dedupeKey: string;
  runId?: number;
  responseCode?: number;
  error?: string;
  triggeredBy: 'run-completion' | 'manual-test';
}

// --- Knowledge Base Chat types ---

export interface ChatConversationListItem {
  id: number;
  title: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ChatMessageCodeReference {
  filePath: string;
  snippet: string;
  repositoryId?: string;
  relevanceScore?: number;
}

export interface ChatMessageItem {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  codeReferences: ChatMessageCodeReference[] | null;
  model: string | null;
  createdAt: string;
}

export interface ChatConversationDetail {
  id: number;
  title: string;
  projectId: number | null;
  messages: ChatMessageItem[];
  createdAt: string;
}

export type TestRerunFramework = 'playwright' | 'junit' | 'testng';
export type TestRerunExecutionMode = 'ci-webhook' | 'agent';
export type TestRerunTriggerMode = 'tests_only' | 'full_pipeline';
export type TestRerunJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';
export type TestRerunSelectionMode = 'single' | 'selected' | 'failed_or_broken';
export type TestRerunSelectorKind =
  | 'allureId'
  | 'historyId'
  | 'testName'
  | 'frameworkId';

export interface TestRerunSelector {
  kind: TestRerunSelectorKind;
  value: string;
  testResultId?: string;
}

export interface TestRerunExecutionProfile {
  id: string;
  name: string;
  framework: TestRerunFramework;
  executionMode: TestRerunExecutionMode;
  triggerMode: TestRerunTriggerMode;
  commandTemplate: string;
  ciTriggerUrl?: string;
  ciHeaders?: Record<string, string>;
  callbackSecret?: string;
  enabled: boolean;
}

export interface TestRerunSettings {
  projectId: string;
  singleFrameworkPerProject: true;
  activeProfileId?: string;
  profiles: TestRerunExecutionProfile[];
}

export interface CreateTestRerunJobRequest {
  selectionMode?: TestRerunSelectionMode;
  selectors: TestRerunSelector[];
  framework?: TestRerunFramework;
  executionProfileId?: string;
  triggerMode?: TestRerunTriggerMode;
  metadata?: Record<string, unknown>;
}

export interface TestRerunActionRequest {
  selectionMode: TestRerunSelectionMode;
  selectors: TestRerunSelector[];
  sourceResultIds?: string[];
}

export interface TestRerunJobResponse {
  jobId: string;
  parentRunId: number;
  childRunId?: number;
  projectId: string;
  status: TestRerunJobStatus;
  framework: TestRerunFramework;
  executionMode: TestRerunExecutionMode;
  selectionMode: TestRerunSelectionMode;
  selectors: TestRerunSelector[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}
