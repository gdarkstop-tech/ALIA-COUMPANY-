export class IntegrationNotConfiguredError extends Error {
  constructor(public readonly integration: string) {
    super(`${integration} integration is not configured in this environment`);
    this.name = 'IntegrationNotConfiguredError';
  }
}
