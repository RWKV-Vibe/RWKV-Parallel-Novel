import i18n from '../i18n';

interface StreamChunk {
  object: string;
  choices: {
    index: number;
    delta: {
      content?: string;
    };
  }[];
}

interface AuthConfig {
  apiUrl: string;
  password: string;
}

const STORAGE_KEY = 'rwkv_auth_config';

// 获取认证配置
const getAuthConfig = (): AuthConfig => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // ignore
    }
  }
  // 回退到环境变量
  return {
    apiUrl: import.meta.env.PUBLIC_RWKV_API_URL || '',
    password: '',
  };
};

export class AIService {
  // 初始生成 - 基于用户输入的内容生成多个版本
  static async generateMultipleResponses(
    userMessage: string | string[], // 支持单个字符串或字符串数组
    count: number = 24,
    onProgress?: (
      index: number,
      content: string,
      isComplete?: boolean,
      tokenRate?: number,
      totalTokens?: number,
    ) => void,
    abortController?: AbortController,
    maxTokens?: number, // 可选的最大 token 数
  ): Promise<string[]> {
    const controller = abortController || new AbortController();

    // 构建 contents 数组
    const contents = Array.isArray(userMessage)
      ? // 如果是数组，直接使用纯内容（续写时）
        userMessage
      : // 如果是字符串，重复 count 次（用于初始生成）
        Array.from(
          { length: count },
          () =>
            `User: ${i18n.t('aiService.promptPrefix')}\n${userMessage}\n\nAssistant: <think>\n</think>`,
        );

    const actualCount = Array.isArray(userMessage) ? userMessage.length : count;

    // 根据是否为继续生成（数组模式）设置不同的默认 token 数
    const defaultMaxTokens = Array.isArray(userMessage) ? 4000 : 800;
    const finalMaxTokens = maxTokens ?? defaultMaxTokens;

    return this._executeGeneration(
      contents,
      actualCount,
      onProgress,
      controller,
      finalMaxTokens,
    );
  }

  // 继续生成 - 基于已有内容继续创作
  static async continueGeneration(
    existingContent: string,
    count: number = 24,
    contextLength: number = 500, // 提取最后多少字符作为上下文
    onProgress?: (
      index: number,
      content: string,
      isComplete?: boolean,
      tokenRate?: number,
      totalTokens?: number,
    ) => void,
    abortController?: AbortController,
    maxTokens: number = 4000, // 继续生成默认使用更多 tokens
  ): Promise<string[]> {
    const controller = abortController || new AbortController();

    // 提取最后部分作为上下文
    const context =
      existingContent.length > contextLength
        ? existingContent.slice(-contextLength)
        : existingContent;

    // 构建继续生成的 prompt - 保持和初始生成相同的格式
    const continuePrompt = `${i18n.t('aiService.promptPrefix')}\n${context}\n这是现在的故事，请继续生成后面的内容`;

    const contents = Array.from(
      { length: count },
      () => `User: ${continuePrompt}\n\nAssistant: <think>\n</think>`,
    );

    return this._executeGeneration(
      contents,
      count,
      onProgress,
      controller,
      maxTokens,
    );
  }

  // 核心生成逻辑 - 被上面两个方法复用
  private static async _executeGeneration(
    contents: string[],
    count: number,
    onProgress?:
      | ((
          index: number,
          content: string,
          isComplete?: boolean,
          tokenRate?: number,
          totalTokens?: number,
        ) => void)
      | undefined,
    controller?: AbortController,
    maxTokens: number = 800, // 默认 token 数
  ): Promise<string[]> {
    // 存储每个 index 的累积内容
    const contentBuffers: string[] = Array.from({ length: count }, () => '');
    const results: string[] = [];

    // Token 速率计算
    let totalTokenCount = 0;
    const startTime = Date.now();

    try {
      const authConfig = getAuthConfig();
      const response = await fetch(authConfig.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          max_tokens: maxTokens,
          temperature: 0.85,
          top_k: 1,
          top_p: 0.4,
          pad_zero: true,
          alpha_presence: 0.5,
          alpha_frequency: 0.5,
          alpha_decay: 0.996,
          chunk_size: 128,
          stream: true,
          password: authConfig.password,
        }),
        signal: controller?.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          i18n.t('aiService.httpError', {
            status: response.status,
            statusText: response.statusText,
            text,
          }),
        );
      }

      if (!response.body) {
        throw new Error(i18n.t('aiService.streamNotAvailable'));
      }

      const reader: ReadableStreamDefaultReader<Uint8Array> =
        response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let partial = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        partial += chunk;

        // 逐行解析 SSE
        const lines = partial.split('\n');
        partial = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const json: StreamChunk = JSON.parse(data);
            if (json.choices && json.choices.length > 0) {
              for (const choice of json.choices) {
                const index = choice.index;
                const delta = choice.delta?.content ?? '';

                if (delta && index >= 0 && index < count) {
                  contentBuffers[index] += delta;

                  // 累计 token 数（delta 的字符数作为 token 的估算）
                  totalTokenCount += delta.length;

                  // 计算当前 token 速率
                  const elapsedSeconds = (Date.now() - startTime) / 1000;
                  const tokenRate =
                    elapsedSeconds > 0
                      ? Math.round(totalTokenCount / elapsedSeconds)
                      : 0;

                  // 每次接收到新内容都通知进度
                  if (onProgress) {
                    onProgress(
                      index,
                      contentBuffers[index],
                      false,
                      tokenRate,
                      totalTokenCount,
                    );
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Failed to parse JSON:', err);
          }
        }
      }

      // 构建最终结果
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const finalTokenRate =
        elapsedSeconds > 0 ? Math.round(totalTokenCount / elapsedSeconds) : 0;

      for (let i = 0; i < count; i++) {
        const content = contentBuffers[i] || '';
        results.push(content);

        // 最后一次调用onProgress，标记该 index 已完成
        if (onProgress && content.length > 0) {
          onProgress(i, content, true, finalTokenRate, totalTokenCount);
        }
      }

      console.log(
        `✅ 生成完成！总计: ${totalTokenCount} tokens, 平均速率: ${finalTokenRate} tok/s, 用时: ${elapsedSeconds.toFixed(2)}s`,
      );

      return results;
    } catch (err: unknown) {
      console.error(i18n.t('aiService.generationFailed'), err);
      throw err;
    }
  }
}
