/** Public structural contract for the Enterprise repository-indexing capability. */
export type IndexedChunk = {
  chunkIndex: number;
  content: string;
  filePath: string;
  repositoryId?: string;
  tokens: string[];
};

export type IndexedCatalog = {
  generatedAt: string;
  repositoryIds: string[];
  chunks: IndexedChunk[];
};

export type RetrievedEvidence = {
  status: "empty" | "ok";
  items: Array<{ chunkIndex: number; filePath: string; repositoryId?: string; relevanceScore: number; snippet: string }>;
  generatedAt: string;
  totalChunksSearched: number;
};

export type IndexingPort = {
  configureAutoIndex(...args: any[]): any;
  syncAutoIndexWatchers(...args: any[]): Promise<any>;
  runAutoIndexTick(...args: any[]): Promise<any>;
  getAutoIndexRuntimeStatus(...args: any[]): any;
  listIndexJobs(...args: any[]): any[];
  createIndexJob(...args: any[]): Promise<any>;
  indexRepositories(...args: any[]): Promise<{ catalog: IndexedCatalog; status: string }>;
  getCatalogSummary(...args: any[]): Promise<{ generatedAt: string | null; repositoryIds: string[]; chunkCount: number; files: string[] }>;
  getLatestCatalog(...args: any[]): IndexedCatalog | null;
  retrieveEvidence(...args: any[]): Promise<RetrievedEvidence>;
  getRetrievalDiagnostics(...args: any[]): any;
  runRetrievalBenchmark(...args: any[]): Promise<any>;
  testConnector(...args: any[]): Promise<any>;
  resolveLocalRepositoryPath(...args: any[]): string;
};
