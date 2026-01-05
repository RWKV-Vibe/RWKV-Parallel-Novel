import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChatgptPromptInput } from '@/components/business/chatgpt-prompt-input';
import { MarkdownRenderer } from '@/components/business/MarkdownRenderer';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { PromptOptimizeDialog } from '@/components/business/PromptOptimizeDialog';
import { Loader2, Wand2, Square, Check, Home, RefreshCw } from 'lucide-react';
import { AIService } from '@/service/ai';
import { useTranslation } from 'react-i18next';

interface GeneratedResult {
  id: string;
  content: string;
  isLoading: boolean;
}

export const ChatPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const initialMessage = (location.state as { initialMessage?: string })
    ?.initialMessage;

  // 从 localStorage 恢复状态（跨标签页共享）
  const [results, setResults] = useState<GeneratedResult[]>(() => {
    const saved = localStorage.getItem('chatPageResults');
    if (saved) {
      const parsed = JSON.parse(saved);
      // 如果保存的结果数量不等于当前的 totalCount，清空重新开始
      if (parsed.length !== 8) {
        localStorage.removeItem('chatPageResults');
        return [];
      }
      return parsed;
    }
    return [];
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false); // 标记是否正在继续生成
  // 使用 ref 存储输入值，不通过 state，避免输入时重新渲染
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 优先使用从首页传来的 initialMessage，否则从 localStorage 恢复
  const initialPrompt = useMemo(
    () => initialMessage || localStorage.getItem('chatPagePrompt') || '',
    [initialMessage],
  );
  const totalCount = 8;

  // Token 速率计算相关状态
  const [tokenRate, setTokenRate] = useState<number>(0);
  const [totalTokens, setTotalTokens] = useState<number>(0);

  // 计算已完成的任务数（使用 Set 追踪已完成的索引）
  const [completedIndexes, setCompletedIndexes] = useState<Set<number>>(() => {
    // 初始化时从 localStorage 恢复的结果中计算已完成的索引
    const saved = localStorage.getItem('chatPageResults');
    if (saved) {
      const savedResults = JSON.parse(saved);
      const completed = new Set<number>();
      savedResults.forEach((result: GeneratedResult, index: number) => {
        if (!result.isLoading && result.content) {
          completed.add(index);
        }
      });
      return completed;
    }
    return new Set();
  });
  const completedTaskCount = completedIndexes.size;

  const resultsRef = useRef(results); // 存储最新的 results 引用

  // 使用全局存储来保持生成状态，避免组件卸载时中断
  const globalState = useMemo(() => {
    if (!(window as any).__chatPageGlobalState) {
      (window as any).__chatPageGlobalState = {
        abortController: null,
        updateBuffer: new Map(),
        isGenerating: false,
      };
    }
    return (window as any).__chatPageGlobalState;
  }, []);

  const abortControllerRef = useRef<AbortController | null>(null);

  // 用于批量更新的缓冲区 - 使用全局存储以避免组件卸载时丢失
  const updateBuffer = useRef<Map<number, { content: string }>>(
    globalState.updateBuffer,
  );
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const localStorageUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 组件挂载时恢复全局状态
  useEffect(() => {
    abortControllerRef.current = globalState.abortController;
    if (globalState.isGenerating && !isGenerating) {
      setIsGenerating(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // 更新 resultsRef
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  // 组件卸载时清理资源（但不中断生成）
  useEffect(() => {
    return () => {
      // 清理定时器
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      // 保存状态到全局，以便页面切换后恢复
      globalState.abortController = abortControllerRef.current;
      globalState.updateBuffer = updateBuffer.current;
      globalState.isGenerating = isGenerating;

      // 不要中断 AbortController，让生成继续在后台进行
    };
  });

  // 存储每个 Markdown 容器的引用
  const markdownContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // 滚动 Markdown 容器到底部 - 使用 requestAnimationFrame 确保在渲染后执行
  const scrollMarkdownToBottom = (index: number) => {
    requestAnimationFrame(() => {
      const container = markdownContainerRefs.current.get(index);
      if (container) {
        // 直接设置 scrollTop，smooth behavior 已在 CSS 中定义
        container.scrollTop = container.scrollHeight;
      }
    });
  };

  // 监听结果变化，自动滚动正在生成的 Markdown
  useEffect(() => {
    if (isGenerating) {
      results.forEach((result, index) => {
        if (!result.isLoading && result.content) {
          scrollMarkdownToBottom(index);
        }
      });
    }
  }, [results, isGenerating]);

  // 保存状态到 localStorage（由 flushUpdates 负责，这里作为备份）
  useEffect(() => {
    if (results.length > 0) {
      // 使用 requestIdleCallback 在空闲时保存，避免阻塞
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(
          () => {
            localStorage.setItem('chatPageResults', JSON.stringify(results));
          },
          { timeout: 100 },
        );
      } else {
        setTimeout(() => {
          localStorage.setItem('chatPageResults', JSON.stringify(results));
        }, 0);
      }
    }
  }, [results]);

  // 移除实时保存 prompt，避免输入卡顿
  // prompt 会在 handleGenerate 时保存

  // 处理初始消息 - 只执行一次，并且如果已经有结果就不重复执行
  const hasProcessedInitialMessage = useRef(false);
  useEffect(() => {
    // 如果已经有保存的结果，说明之前已经生成过了，不需要再处理
    const hasExistingResults = results.length > 0 && !results[0]?.isLoading;

    if (
      initialMessage &&
      !hasProcessedInitialMessage.current &&
      !hasExistingResults
    ) {
      hasProcessedInitialMessage.current = true;
      // 标记已处理，避免返回后重复执行
      localStorage.setItem('hasProcessedInitialMessage', 'true');
      handleGenerate(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = useCallback(
    async (userPrompt: string) => {
      // 取消之前正在进行的请求
      if (globalState.abortController) {
        globalState.abortController.abort();
      }

      // 创建新的 AbortController
      const newAbortController = new AbortController();
      abortControllerRef.current = newAbortController;
      globalState.abortController = newAbortController;

      setIsGenerating(true);
      globalState.isGenerating = true;

      // 清除旧的结果和标记
      localStorage.removeItem('chatPageResults');
      localStorage.removeItem('hasProcessedInitialMessage');

      // 保存新的 prompt
      localStorage.setItem('chatPagePrompt', userPrompt);

      // 清空已完成索引集合
      setCompletedIndexes(new Set());

      // 重置 token 计数
      setTokenRate(0);
      setTotalTokens(0);

      // 初始化占位符
      const placeholders: GeneratedResult[] = Array.from(
        { length: totalCount },
        (_, i) => ({
          id: `result-${i}`,
          content: '',
          isLoading: true,
        }),
      );
      setResults(placeholders);

      // BroadcastChannel 用于跨标签页通信
      const broadcastChannel = new BroadcastChannel('rwkv-detail-channel');

      // 监听 DetailPage 的就绪信号
      const activeDetailPages = new Set<number>();
      const handleBroadcastMessage = (event: MessageEvent) => {
        if (event.data.type === 'DETAIL_READY') {
          activeDetailPages.add(event.data.index);
        }
      };
      broadcastChannel.addEventListener('message', handleBroadcastMessage);

      // 立即更新 localStorage（不使用节流，确保数据实时可用）
      const updateSessionStorage = () => {
        try {
          const savedResults = localStorage.getItem('chatPageResults');
          if (savedResults) {
            const results = JSON.parse(savedResults);
            // 合并 updateBuffer 中的所有更新
            let hasUpdate = false;
            updateBuffer.current.forEach((update, index) => {
              if (results[index]) {
                results[index] = {
                  ...results[index],
                  content: update.content,
                  isLoading: false,
                };
                hasUpdate = true;
              }
            });
            if (hasUpdate) {
              localStorage.setItem('chatPageResults', JSON.stringify(results));
            }
          }
        } catch (error) {
          console.error('更新 localStorage 失败:', error);
        }
      };

      // 批量更新函数
      const flushUpdates = () => {
        if (updateBuffer.current.size > 0) {
          const updates = new Map(updateBuffer.current);
          // 不清空 updateBuffer，保留数据供 DetailPage 使用

          console.log(`flushUpdates: 准备更新 ${updates.size} 个结果`);

          // 输出更新详情
          const updateDetails = Array.from(updates.entries())
            .slice(0, 3)
            .map(([idx, data]) => `#${idx}: ${data.content?.length || 0} 字符`);
          console.log('更新详情（前3个）:', updateDetails);

          // 广播更新到所有打开的 DetailPage
          updates.forEach((update, index) => {
            try {
              broadcastChannel.postMessage({
                type: 'UPDATE_CONTENT',
                index,
                content: update.content,
              });
            } catch (error) {
              console.error(`发送更新到 DetailPage #${index} 失败:`, error);
            }
          });

          // 更新 results 状态
          setResults((prev) => {
            const newResults = prev.map((result, i) => {
              const update = updates.get(i);
              return update
                ? {
                    ...result,
                    content: update.content,
                    isLoading: false,
                  }
                : result;
            });

            // 立即保存到 localStorage
            localStorage.setItem('chatPageResults', JSON.stringify(newResults));

            // 验证保存
            const savedLength = newResults.filter((r) => r.content).length;
            console.log(
              `flushUpdates: 已保存 ${newResults.length} 个结果，其中 ${savedLength} 个有效`,
            );

            return newResults;
          });
        } else {
          console.warn('⚠️ flushUpdates: updateBuffer 为空，跳过更新');
        }
      };

      try {
        await AIService.generateMultipleResponses(
          userPrompt,
          totalCount,
          (index, content, isComplete = false, currentTokenRate, currentTotalTokens) => {
            // 更新 token 速率和总数
            if (currentTokenRate !== undefined) {
              setTokenRate(currentTokenRate);
            }
            if (currentTotalTokens !== undefined) {
              setTotalTokens(currentTotalTokens);
            }

            // 将更新添加到缓冲区（同时更新本地和全局）
            const updateData = { content };
            updateBuffer.current.set(index, updateData);
            globalState.updateBuffer.set(index, updateData);

            // 标记为完成的条件
            if (isComplete) {
              setCompletedIndexes((prev) => {
                const newSet = new Set(prev);
                newSet.add(index);
                return newSet;
              });
            }

            // 检测内容是否足够长，可以显示了
            const hasEnoughContent = content.length > 100;

            if (hasEnoughContent || isComplete) {
              // 立即更新
              if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
                updateTimeoutRef.current = null;
              }
              flushUpdates();
              updateSessionStorage();
            } else {
              // 使用节流：每 300ms 批量更新一次 UI 和 localStorage
              if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
              }
              updateTimeoutRef.current = setTimeout(() => {
                flushUpdates();
                updateSessionStorage();
              }, 300);
            }
          },
          newAbortController,
        );

        // 确保所有剩余更新都被应用
        if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
        }
        if (localStorageUpdateTimeoutRef.current) {
          clearTimeout(localStorageUpdateTimeoutRef.current);
        }

        console.log(
          `生成完成，开始最终数据保存。updateBuffer 大小: ${updateBuffer.current.size}`,
        );
        console.log(
          'updateBuffer 的所有 keys:',
          Array.from(updateBuffer.current.keys()),
        );

        // 输出前 3 个 buffer 数据的长度
        const samples = Array.from(updateBuffer.current.entries()).slice(0, 3);
        console.log(
          '前 3 个 buffer 数据:',
          samples.map(
            ([idx, data]) => `#${idx}: ${data.content?.length || 0} 字符`,
          ),
        );

        flushUpdates();
        updateSessionStorage();

        // 再次确保所有数据已保存（延迟 200ms 等待状态更新）
        setTimeout(() => {
          try {
            console.log('执行最终保存...');

            // 构建完整的最终结果
            const finalResults = resultsRef.current.map((result, i) => {
              const bufferData =
                updateBuffer.current.get(i) || globalState.updateBuffer.get(i);
              if (bufferData) {
                return {
                  ...result,
                  content: bufferData.content,
                  isLoading: false,
                };
              }
              return result;
            });

            localStorage.setItem(
              'chatPageResults',
              JSON.stringify(finalResults),
            );

            console.log(`✅ 最终保存完成，总数: ${finalResults.length}`);
            console.log(
              '前 3 个结果的内容长度:',
              finalResults
                .slice(0, 3)
                .map((r, i) => `#${i}: ${r.content?.length || 0}`),
            );
          } catch (error) {
            console.error('最终保存 localStorage 失败:', error);
          }
        }, 200);

        // 广播生成完成
        broadcastChannel.postMessage({ type: 'GENERATION_COMPLETE' });

        // 延迟关闭 channel，确保所有消息都已发送
        setTimeout(() => {
          broadcastChannel.removeEventListener(
            'message',
            handleBroadcastMessage,
          );
          broadcastChannel.close();
        }, 500);
      } catch (error: unknown) {
        // 检查是否是用户主动取消
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('生成失败:', error);
        }

        // 清理定时器
        if (localStorageUpdateTimeoutRef.current) {
          clearTimeout(localStorageUpdateTimeoutRef.current);
        }

        // 将所有仍在加载的卡片标记为加载完成
        setResults((prev) =>
          prev.map((result) => ({ ...result, isLoading: false })),
        );
        // 广播错误消息
        broadcastChannel.postMessage({ type: 'GENERATION_ERROR' });
        // 延迟关闭 BroadcastChannel
        setTimeout(() => {
          broadcastChannel.removeEventListener(
            'message',
            handleBroadcastMessage,
          );
          broadcastChannel.close();
        }, 500);
      } finally {
        // 只有当前 AbortController 没有被新的请求替换时才设置为 false
        if (globalState.abortController === newAbortController) {
          setIsGenerating(false);
          globalState.isGenerating = false;
          abortControllerRef.current = null;
          globalState.abortController = null;
        }
      }
    },
    [totalCount, globalState],
  );

  const handleOpenDetail = useCallback(
    (index: number) => {
      if (results[index] && !results[index].isLoading) {
        console.log(`============ 打开 DetailPage #${index} ============`);

        // 强制立即保存当前所有数据到 localStorage
        try {
          // 合并 updateBuffer 的最新数据
          const finalResults = results.map((result, i) => {
            const bufferData =
              updateBuffer.current.get(i) || globalState.updateBuffer.get(i);
            if (bufferData && bufferData.content) {
              return {
                ...result,
                content: bufferData.content,
                isLoading: false,
              };
            }
            return result;
          });

          // 立即保存
          localStorage.setItem('chatPageResults', JSON.stringify(finalResults));

          console.log(`强制保存数据:`, {
            总数: finalResults.length,
            目标索引: index,
            目标内容长度: finalResults[index]?.content?.length || 0,
            来自buffer: updateBuffer.current.has(index),
            来自results: !updateBuffer.current.has(index),
          });

          // 验证保存成功
          const verify = localStorage.getItem('chatPageResults');
          if (verify) {
            const parsed = JSON.parse(verify);
            console.log(
              `✅ 验证保存成功，#${index} 的内容长度: ${parsed[index]?.content?.length || 0}`,
            );
          } else {
            console.error('❌ 验证失败：localStorage 保存失败！');
          }
        } catch (error) {
          console.error('强制保存失败:', error);
        }

        // 在新标签页中打开
        const detailUrl = `/detail?index=${index}`;
        window.open(detailUrl, '_blank', 'noopener,noreferrer');
        console.log(`============ 新标签页已打开 ============`);
      }
    },
    [results, globalState],
  );

  // 输入框占位符
  const inputPlaceholder = useMemo(
    () => '输入小说开头或续写提示，例如：一个风雨交加的夜晚...',
    [t],
  );

  // Prompt 优化相关状态
  const [isOptimizeDialogOpen, setIsOptimizeDialogOpen] = useState(false);

  // 打开优化 Dialog
  const handleOpenOptimizeDialog = useCallback(() => {
    setIsOptimizeDialogOpen(true);
  }, []);

  // 关闭优化 Dialog
  const handleCloseOptimizeDialog = useCallback(() => {
    setIsOptimizeDialogOpen(false);
  }, []);

  // 使用优化后的 Prompt
  const handleUseOptimizedPrompt = useCallback((optimizedPrompt: string) => {
    if (inputRef.current) {
      inputRef.current.value = optimizedPrompt;
    }
  }, []);

  // 预设 Prompt 建议（小说续写主题）
  const suggestions = useMemo(
    () => [
      '科幻冒险：星际探险队发现了一颗神秘的古老星球',
      '都市情感：一场意外的邂逅改变了两个人的命运',
      '奇幻冒险：年轻的魔法学徒踏上寻找失落魔法的旅程',
      '悬疑推理：一桩尘封多年的案件突然浮出水面',
    ],
    [t],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      handleGenerate(suggestion);
    },
    [handleGenerate],
  );

  // 提交时从 input 元素获取值
  const handleSubmit = useCallback(
    (content?: string) => {
      const valueToSubmit = content || inputRef.current?.value || '';
      if (valueToSubmit.trim()) {
        handleGenerate(valueToSubmit);
      }
    },
    [handleGenerate],
  );

  // 终止生成
  const handleStopGenerate = useCallback(() => {
    if (globalState.abortController) {
      globalState.abortController.abort();
      globalState.abortController = null;
      abortControllerRef.current = null;
    }

    // 清理更新定时器
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    // 清理 localStorage 更新定时器
    if (localStorageUpdateTimeoutRef.current) {
      clearTimeout(localStorageUpdateTimeoutRef.current);
      localStorageUpdateTimeoutRef.current = null;
    }

    // 立即应用所有待处理的更新
    if (updateBuffer.current.size > 0) {
      const updates = new Map(updateBuffer.current);
      // 不清空 buffer，保留数据供 DetailPage 使用

      setResults((prev) => {
        const newResults = prev.map((result, i) => {
          const update = updates.get(i);
          return update
            ? {
                ...result,
                content: update.content,
                isLoading: false,
              }
            : { ...result, isLoading: false };
        });

        // 立即保存到 localStorage
        localStorage.setItem('chatPageResults', JSON.stringify(newResults));
        return newResults;
      });
    } else {
      // 将所有仍在加载的结果标记为加载完成
      setResults((prev) => {
        const newResults = prev.map((result) => ({
          ...result,
          isLoading: false,
        }));
        localStorage.setItem('chatPageResults', JSON.stringify(newResults));
        return newResults;
      });
    }

    setIsGenerating(false);
    globalState.isGenerating = false;
  }, [globalState]);

  // 返回首页
  const handleBackToHome = useCallback(() => {
    navigate('/');
  }, [navigate]);

  // 继续生成所有版本（并发）
  const handleContinueGenerate = useCallback(
    async () => {
      // 检查是否有可以继续的内容
      const hasValidContent = results.some(r => r.content && !r.isLoading);
      if (!hasValidContent || isContinuing || isGenerating) {
        return;
      }

      setIsContinuing(true);
      
      // 获取所有当前内容
      const contexts = results.map(r => r.content || '');
      
      // 创建新的 AbortController
      const newAbortController = new AbortController();
      abortControllerRef.current = newAbortController;
      globalState.abortController = newAbortController;

      // BroadcastChannel 用于跨标签页通信
      const broadcastChannel = new BroadcastChannel('rwkv-detail-channel');

      // 批量更新函数
      const flushUpdates = () => {
        if (updateBuffer.current.size > 0) {
          const updates = new Map(updateBuffer.current);

          // 广播更新到所有打开的 DetailPage
          updates.forEach((update, index) => {
            try {
              broadcastChannel.postMessage({
                type: 'UPDATE_CONTENT',
                index,
                content: update.content,
              });
            } catch (error) {
              console.error(`发送更新到 DetailPage #${index} 失败:`, error);
            }
          });

          // 更新 results 状态
          setResults((prev) => {
            const newResults = prev.map((result, i) => {
              const update = updates.get(i);
              return update
                ? {
                    ...result,
                    content: update.content,
                    isLoading: false,
                  }
                : result;
            });

            // 立即保存到 localStorage
            localStorage.setItem('chatPageResults', JSON.stringify(newResults));
            return newResults;
          });
        }
      };

      try {
        // 直接使用 AI 生成的内容进行续写
        // promptPrefix 会在 ai.ts 中自动添加
        const continuePrompts = contexts;

        // 使用 generateMultipleResponses 的数组模式并发续写
        await AIService.generateMultipleResponses(
          continuePrompts,
          totalCount,
          (index, content, isComplete = false, currentTokenRate, currentTotalTokens) => {
            // 更新 token 速率和总数
            if (currentTokenRate !== undefined) {
              setTokenRate(currentTokenRate);
            }
            if (currentTotalTokens !== undefined) {
              setTotalTokens(currentTotalTokens);
            }

            // 追加新内容到原内容后面
            const originalContent = contexts[index] || '';
            const newContent = originalContent + '\n\n' + content;

            // 将更新添加到缓冲区
            const updateData = { content: newContent };
            updateBuffer.current.set(index, updateData);
            globalState.updateBuffer.set(index, updateData);

            // 标记为完成
            if (isComplete) {
              setCompletedIndexes((prev) => {
                const newSet = new Set(prev);
                newSet.add(index);
                return newSet;
              });
            }

            // 检测内容是否足够长，可以显示了
            const hasEnoughContent = content.length > 100;

            if (hasEnoughContent || isComplete) {
              // 立即更新
              if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
                updateTimeoutRef.current = null;
              }
              flushUpdates();
            } else {
              // 使用节流：每 300ms 批量更新一次
              if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
              }
              updateTimeoutRef.current = setTimeout(() => {
                flushUpdates();
              }, 300);
            }
          },
          newAbortController,
        );

        // 确保所有剩余更新都被应用
        if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
        }

        flushUpdates();

        // 再次确保所有数据已保存
        setTimeout(() => {
          try {
            const finalResults = resultsRef.current.map((result, i) => {
              const bufferData =
                updateBuffer.current.get(i) || globalState.updateBuffer.get(i);
              if (bufferData) {
                return {
                  ...result,
                  content: bufferData.content,
                  isLoading: false,
                };
              }
              return result;
            });

            localStorage.setItem(
              'chatPageResults',
              JSON.stringify(finalResults),
            );

            console.log(`✅ 继续生成完成，总数: ${finalResults.length}`);
          } catch (error) {
            console.error('保存失败:', error);
          }
        }, 200);

        // 广播生成完成
        broadcastChannel.postMessage({ type: 'GENERATION_COMPLETE' });
        
        setTimeout(() => {
          broadcastChannel.close();
        }, 500);
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('继续生成失败:', error);
        }
        broadcastChannel.postMessage({ type: 'GENERATION_ERROR' });
        setTimeout(() => {
          broadcastChannel.close();
        }, 500);
      } finally {
        if (globalState.abortController === newAbortController) {
          setIsContinuing(false);
          abortControllerRef.current = null;
          globalState.abortController = null;
        }
      }
    },
    [results, isContinuing, isGenerating, totalCount, globalState]
  );

  return (
    <div className="flex flex-col h-screen bg-background dark:bg-[#1e1e1e]">
      {/* 返回首页按钮 - 左上角 */}
      <div className="fixed top-6 left-6 z-50">
        <button
          onClick={handleBackToHome}
          className="flex items-center justify-center h-16 w-16 rounded-full
                     bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600
                     text-white shadow-lg hover:shadow-xl
                     transition-all duration-200 hover:scale-105
                     border-2 border-blue-400 dark:border-blue-400"
          title={t('chatpage.backToHome') || '返回首页'}
        >
          <Home className="h-6 w-6" />
        </button>
      </div>

      {/* Language Switcher - 右上角 */}
      <div className="fixed top-6 right-6 z-50">
        <LanguageSwitcher />
      </div>

      {/* Prompt 优化 Dialog */}
      <PromptOptimizeDialog
        isOpen={isOptimizeDialogOpen}
        initialPrompt={inputRef.current?.value || initialPrompt}
        onClose={handleCloseOptimizeDialog}
        onUsePrompt={handleUseOptimizedPrompt}
      />

      {/* 顶部：输入区域 */}
      <div className="border-b border-border dark:border-gray-700 bg-white dark:bg-[#252525]">
        <div className="max-w-[2400px] mx-auto p-6">
          <div className="flex items-center gap-4">
            {/* 输入框 - 非受控组件，输入时不触发重新渲染 */}
            <div className="flex-1">
              <ChatgptPromptInput
                ref={inputRef}
                key={initialPrompt}
                defaultValue={initialPrompt}
                placeholder={inputPlaceholder}
                onSubmit={handleSubmit}
              />
            </div>

            {/* 魔法棒按钮 - 优化 Prompt */}
            <button
              onClick={handleOpenOptimizeDialog}
              className="flex items-center justify-center h-16 w-16 rounded-full
                         bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600
                         text-white shadow-lg hover:shadow-xl
                         transition-all duration-200 hover:scale-105
                         border-2 border-purple-400 dark:border-purple-400"
              title="优化续写提示"
            >
              <Wand2 className="h-6 w-6" />
            </button>

            {/* 任务状态和控制按钮 */}
            {results.length > 0 && (
              <div className="flex items-center gap-6">
                {/* 任务状态显示 */}
                <div className="flex items-center gap-4 px-8 py-4 bg-gray-100 dark:bg-gray-800 rounded-full">
                  {(isGenerating || isContinuing) ? (
                    <>
                      <Loader2 className="h-10 w-10 animate-spin text-blue-600 dark:text-blue-400" />
                      <span className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                        {completedTaskCount}/{totalCount}
                      </span>
                    </>
                  ) : (
                    <>
                      <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
                      <span className="text-4xl font-bold text-green-600 dark:text-green-400">
                        {completedTaskCount}/{totalCount}
                      </span>
                    </>
                  )}
                </div>

                {/* Token 速率显示 */}
                {(isGenerating || isContinuing) && tokenRate > 0 && (
                  <div className="flex flex-col items-center gap-1 px-8 py-4 bg-purple-100 dark:bg-purple-900/30 rounded-full">
                    <span className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                      {tokenRate.toLocaleString()} tok/s
                    </span>
                    <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                      总计: {totalTokens.toLocaleString()} tokens
                    </span>
                  </div>
                )}

                {/* 继续生成按钮 - 生成完成后显示 */}
                {!isGenerating && !isContinuing && completedTaskCount === totalCount && (
                  <button
                    onClick={handleContinueGenerate}
                    className="flex items-center gap-3 px-8 py-4 rounded-full
                               bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600
                               text-white shadow-lg hover:shadow-xl
                               transition-all duration-200 hover:scale-105
                               border-2 border-green-400 dark:border-green-400"
                    title="继续生成"
                  >
                    <RefreshCw className="h-8 w-8" />
                    <span className="text-2xl font-bold">继续生成</span>
                  </button>
                )}

                {/* 终止生成按钮 */}
                {(isGenerating || isContinuing) && (
                    <button
                    onClick={handleStopGenerate}
                    className="flex items-center justify-center h-20 w-20 rounded-full
                               bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600
                               text-white shadow-lg hover:shadow-xl
                               transition-all duration-200 hover:scale-105
                               border-2 border-red-400 dark:border-red-400"
                    title="停止生成"
                  >
                    <Square className="h-10 w-10" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 中间：网页预览网格或预设建议 */}
      <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-[#1a1a1a]">
        {results.length === 0 ? (
          /* 预设 Prompt 建议 */
          <div className="max-w-[1600px] mx-auto flex flex-col items-center justify-center h-full gap-8">
            <h2 className="text-4xl font-bold text-gray-700 dark:text-gray-300">
              选择一个主题开始创作
            </h2>
            <p className="text-lg text-gray-500 dark:text-gray-400">
              AI 将为你续写 8 个不同版本的小说内容
            </p>
            <div className="w-full grid grid-cols-2 gap-6">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="w-full px-8 py-6 rounded-xl text-xl font-medium text-left
                             bg-white dark:bg-[#2d3135] hover:bg-gray-50 dark:hover:bg-[#3b4045]
                             text-gray-700 dark:text-white transition-all duration-200
                             border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500
                             shadow-lg hover:shadow-xl hover:scale-[1.02] transform"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full w-full">
            <div className="grid grid-cols-4 grid-rows-2 gap-6 h-full w-full">
              {results.map((result, index) => (
                <div
                  key={result.id}
                  className={`group flex flex-col rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600 transition-all ${
                    result.isLoading || isContinuing
                      ? 'cursor-not-allowed opacity-70'
                      : 'hover:border-blue-400 hover:shadow-xl cursor-pointer'
                  }`}
                  onClick={() => !result.isLoading && !isContinuing && handleOpenDetail(index)}
                >
                  {result.isLoading ? (
                    <div className="w-full h-full bg-white dark:bg-[#2d2d2d] flex items-center justify-center">
                      <div className="text-center">
                        <Loader2 className="h-24 w-24 animate-spin text-blue-500 mx-auto mb-8" />
                        <p className="text-5xl font-bold text-gray-500 dark:text-gray-400">
                          {t('chatpage.generating') || '生成中...'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={(el) => {
                        if (el) {
                          markdownContainerRefs.current.set(index, el);
                        }
                      }}
                      className="h-full bg-white dark:bg-[#1e1e1e] relative overflow-auto will-change-scroll prose prose-2xl max-w-none"
                      style={{
                        scrollBehavior: 'smooth',
                        isolation: 'isolate',
                        fontSize: '2rem',
                        lineHeight: '2.2',
                      }}
                    >
                      <div className="p-12" style={{ fontSize: '2rem' }}>
                        <MarkdownRenderer content={result.content} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
