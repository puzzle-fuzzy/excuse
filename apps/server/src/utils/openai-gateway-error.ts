import type { OpenAIGatewayError } from '@excuse/gateway'
import type { OpenAIErrorResponse } from '@excuse/shared'
import { AppError } from './app-errors'

/**
 * Bridges pure @excuse/gateway protocol errors into the server-wide AppError
 * pipeline while preserving the OpenAI-compatible response body.
 */
export class OpenAIGatewayAppError extends AppError {
  readonly response: OpenAIErrorResponse

  constructor(error: OpenAIGatewayError) {
    super(error.status, error.response.error.message)
    this.name = 'OpenAIGatewayAppError'
    this.response = error.response
  }

  override toResponse(): OpenAIErrorResponse {
    return this.response
  }
}

export function throwOpenAIGatewayError(error: OpenAIGatewayError): never {
  throw new OpenAIGatewayAppError(error)
}
