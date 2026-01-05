import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Copy, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MarkdownRenderer } from '@/components/business/MarkdownRenderer';

const DEFAULT_TEXT = '暂无内容';

export const DetailPage = () => {
  const location = useLocation();
  const { t } = useTranslation();

  // 从 URL 查询参数获取 index
  const searchParams = new URLSearchParams(location.search);
  const resultIndex = searchParams.get('index')
    ? parseInt(searchParams.get('index')!)
    : undefined;

  // 从 localStorage 获取初始数据
  const [initialText] = useState(() => {
    if (resultIndex === undefined) {
      console.warn('DetailPage: resultIndex 未定义');
      return (
        (location.state as { content?: string })?.content || DEFAULT_TEXT
      );
    }

    console.log(
      `DetailPage #${resultIndex} 初始化，从 localStorage 读取数据...`,
    );

    // 1. 先从 localStorage 的 chatPageResults 读取（跨标签页共享）
    try {
      const chatPageResults = localStorage.getItem('chatPageResults');
      if (chatPageResults) {
        const results = JSON.parse(chatPageResults);
        const content = results[resultIndex]?.content;

        if (content && content !== DEFAULT_TEXT) {
          console.log(
            `✅ 从 localStorage 读取成功，文本长度: ${content.length}`,
          );
          return content;
        } else {
          console.log(
            `localStorage 中索引 ${resultIndex} 的数据无效，长度: ${content?.length || 0}`,
          );
        }
      } else {
        console.log('localStorage 不存在，尝试从 globalState 读取');
      }
    } catch (error) {
      console.error('从 localStorage 读取失败:', error);
    }

    // 2. 如果 chatPageResults 没有，从 globalState 读取（生成中的数据）
    try {
      const globalState = (window as any).__chatPageGlobalState;
      if (globalState?.updateBuffer) {
        const latestUpdate = globalState.updateBuffer.get(resultIndex);
        if (latestUpdate?.content && latestUpdate.content !== DEFAULT_TEXT) {
          console.log(
            `✅ 从 globalState 读取成功，文本长度: ${latestUpdate.content.length}`,
          );
          return latestUpdate.content;
        }
      }
    } catch (error) {
      console.error('从 globalState 读取失败:', error);
    }

    // 3. 都失败，使用默认值
    console.error(`❌ DetailPage #${resultIndex} 无法获取有效数据`);
    return DEFAULT_TEXT;
  });

  const [textContent, setTextContent] = useState(initialText);
  const [copied, setCopied] = useState(false);
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);

  // 监听 BroadcastChannel 接收实时更新
  useEffect(() => {
    if (resultIndex === undefined) {
      console.warn('DetailPage: resultIndex 未定义');
      return;
    }

    const channel = new BroadcastChannel('rwkv-detail-channel');

    // 检查是否正在生成
    const globalState = (window as any).__chatPageGlobalState;
    if (globalState && globalState.isGenerating) {
      setIsLiveUpdating(true);

      // 从 updateBuffer 获取最新内容
      const updateBuffer = globalState.updateBuffer;
      if (updateBuffer && updateBuffer.has(resultIndex)) {
        const latestUpdate = updateBuffer.get(resultIndex);
        if (latestUpdate && latestUpdate.content) {
          setTextContent(latestUpdate.content);
        }
      }
    }

    channel.onmessage = (event) => {
      const { type, index, content: newContent } = event.data;

      // 处理初始化消息（INIT_DETAIL）- 作为备用初始化方式
      if (type === 'INIT_DETAIL' && index === resultIndex) {
        if (newContent && newContent !== DEFAULT_TEXT) {
          setTextContent(newContent);
          setIsLiveUpdating(globalState?.isGenerating || false);
        }
        return;
      }

      // 只处理与当前 index 匹配的 UPDATE_CONTENT 消息
      if (index !== resultIndex) return;

      if (type === 'UPDATE_CONTENT' && newContent) {
        setTextContent(newContent);
        setIsLiveUpdating(true);
      } else if (
        type === 'GENERATION_COMPLETE' ||
        type === 'GENERATION_ERROR'
      ) {
        setIsLiveUpdating(false);
      }
    };

    // 发送就绪信号
    channel.postMessage({
      type: 'DETAIL_READY',
      index: resultIndex,
    });

    return () => {
      channel.close();
    };
  }, [resultIndex]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error(t('detailpage.copyFailed'), error);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novel-${resultIndex !== undefined ? resultIndex + 1 : 'export'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen bg-background dark:bg-[#1e1e1e]">
      {/* 顶部工具栏 */}
      <div className="h-20 sm:h-24 md:h-28 lg:h-32 xl:h-36 border-b-2 border-border dark:border-gray-700 bg-white dark:bg-[#252525] flex items-center justify-between px-6 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <div className="flex items-center gap-4 sm:gap-6 md:gap-8 lg:gap-12">
          {resultIndex !== undefined && (
            <div className="flex items-center gap-4">
              <span className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-600 dark:text-gray-400">
                {t('detailpage.solution', { number: resultIndex + 1 })}
              </span>
              {isLiveUpdating && (
                <span className="flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900 rounded-full text-sm font-semibold text-blue-600 dark:text-blue-300 animate-pulse">
                  <span className="w-2 h-2 bg-blue-600 dark:bg-blue-300 rounded-full"></span>
                  <span>{t('detailpage.liveUpdating') || '实时更新中'}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 sm:gap-4 md:gap-6 lg:gap-8">
          {/* 操作按钮 */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-3 md:gap-4 px-6 py-3 sm:px-8 sm:py-4 md:px-10 md:py-5 lg:px-12 lg:py-6 xl:px-14 xl:py-7 rounded-2xl text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 hover:scale-[1.02] shadow-lg"
          >
            <Copy className="h-6 w-6 sm:h-8 sm:w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 xl:h-14 xl:w-14" />
            <span className="hidden md:inline">
              {copied ? t('detailpage.copied') : t('detailpage.copyCode')}
            </span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-3 md:gap-4 px-6 py-3 sm:px-8 sm:py-4 md:px-10 md:py-5 lg:px-12 lg:py-6 xl:px-14 xl:py-7 rounded-2xl text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all duration-200 hover:scale-[1.02] shadow-xl hover:shadow-2xl"
          >
            <Download className="h-6 w-6 sm:h-8 sm:w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 xl:h-14 xl:w-14" />
            <span className="hidden md:inline">{t('detailpage.download')}</span>
          </button>
        </div>
      </div>

      {/* 主内容区域：全屏阅读模式 */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#1e1e1e]">
        <div className="max-w-[1200px] mx-auto p-8 sm:p-12 md:p-16 lg:p-20 xl:p-24">
          <div className="prose prose-lg md:prose-xl lg:prose-2xl dark:prose-invert max-w-none">
            <MarkdownRenderer content={textContent} />
          </div>
        </div>
      </div>
    </div>
  );
};
