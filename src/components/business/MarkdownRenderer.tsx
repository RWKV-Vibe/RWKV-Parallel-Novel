import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
  return (
    <div className="prose prose-lg dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children }) {
            return (
              <p className="mb-6 leading-relaxed text-gray-900 dark:text-gray-200" style={{ fontSize: '1.5rem', lineHeight: '2.2' }}>
                {children}
              </p>
            );
          },
          h1({ children }) {
            return (
              <h1 className="font-bold mb-8 mt-12 first:mt-0 text-indigo-600 dark:text-indigo-400 border-b-4 border-indigo-500/40 dark:border-indigo-400/40 pb-4" style={{ fontSize: '2.5rem' }}>
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="font-bold mb-6 mt-10 first:mt-0 text-blue-600 dark:text-blue-400 border-b-2 border-blue-500/30 dark:border-blue-400/30 pb-3" style={{ fontSize: '2rem' }}>
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="font-semibold mb-4 mt-8 first:mt-0 text-emerald-600 dark:text-emerald-400" style={{ fontSize: '1.75rem' }}>
                {children}
              </h3>
            );
          },
          strong({ children }) {
            return (
              <strong className="font-bold text-gray-900 dark:text-gray-100">
                {children}
              </strong>
            );
          },
          em({ children }) {
            return (
              <em className="italic text-gray-700 dark:text-gray-300">
                {children}
              </em>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 pl-6 pr-6 py-4 italic my-6 rounded-r-lg text-gray-800 dark:text-gray-300">
                {children}
              </blockquote>
            );
          },
          ul({ children }) {
            return (
              <ul className="list-disc list-outside ml-8 mb-6 space-y-2 text-gray-900 dark:text-gray-200">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="list-decimal list-outside ml-8 mb-6 space-y-2 text-gray-900 dark:text-gray-200">
                {children}
              </ol>
            );
          },
          hr() {
            return <hr className="my-8 border-gray-200 dark:border-gray-700" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
