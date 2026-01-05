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
                  <span>{t('detailpage.liveUpdating')}</span>
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

      {/* 主内容区域：分屏视图 */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#1e1e1e]">
        <div className="w-full h-full grid grid-cols-1 lg:grid-cols-2 gap-0">
          {/* 左侧：原始Markdown */}
          <div className="h-full overflow-auto bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#1a1a1a] dark:to-[#252525] border-r-2 border-gray-300 dark:border-gray-600">
            <div className="p-8 md:p-10 lg:p-12">
              <div className="sticky top-0 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#1a1a1a] dark:to-[#252525] pb-6 mb-8 border-b-4 border-blue-500 dark:border-blue-400 z-10 backdrop-blur-sm bg-opacity-95">
                <h3 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
                  {t('detailpage.rawMarkdown')}
                </h3>
              </div>
              <pre className="font-mono text-base md:text-lg lg:text-xl xl:text-2xl leading-loose whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300 selection:bg-blue-200 dark:selection:bg-blue-900">
{textContent}
              </pre>
            </div>
          </div>

          {/* 右侧：渲染后的内容 */}
          <div className="h-full overflow-auto bg-white dark:bg-[#1e1e1e]">
            <div className="p-8 md:p-10 lg:p-12">
              <div className="sticky top-0 bg-white dark:bg-[#1e1e1e] pb-6 mb-8 border-b-4 border-green-500 dark:border-green-400 z-10 backdrop-blur-sm bg-opacity-95">
                <h3 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-600 to-teal-600 dark:from-green-400 dark:to-teal-400">
                  {t('detailpage.renderedPreview')}
                </h3>
              </div>
              <div className="
                prose prose-lg md:prose-xl lg:prose-2xl 
                dark:prose-invert max-w-none
                prose-headings:font-bold 
                prose-h1:text-4xl md:prose-h1:text-5xl lg:prose-h1:text-6xl 
                prose-h1:mb-6 prose-h1:mt-8 
                prose-h1:text-gray-900 dark:prose-h1:text-gray-100
                prose-h1:border-b-4 prose-h1:border-blue-500 dark:prose-h1:border-blue-400 
                prose-h1:pb-4
                prose-h2:text-3xl md:prose-h2:text-4xl lg:prose-h2:text-5xl 
                prose-h2:mb-4 prose-h2:mt-8
                prose-h2:text-gray-800 dark:prose-h2:text-gray-200
                prose-h2:border-l-8 prose-h2:border-green-500 dark:prose-h2:border-green-400
                prose-h2:pl-6
                prose-h3:text-2xl md:prose-h3:text-3xl lg:prose-h3:text-4xl
                prose-h3:mb-3 prose-h3:mt-6
                prose-h3:text-gray-700 dark:prose-h3:text-gray-300
                prose-p:text-xl md:prose-p:text-2xl lg:prose-p:text-3xl
                prose-p:leading-relaxed prose-p:mb-6
                prose-p:text-gray-700 dark:prose-p:text-gray-300
                prose-strong:text-blue-700 dark:prose-strong:text-blue-300
                prose-strong:font-extrabold
                prose-em:text-purple-700 dark:prose-em:text-purple-300
                prose-em:italic prose-em:font-semibold
                prose-em:bg-purple-50 dark:prose-em:bg-purple-900/20
                prose-em:px-2 prose-em:py-1 prose-em:rounded
                prose-hr:border-t-4 prose-hr:border-gray-300 dark:prose-hr:border-gray-600
                prose-hr:my-10
                selection:bg-green-200 dark:selection:bg-green-900
              ">
                <MarkdownRenderer content={textContent} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
