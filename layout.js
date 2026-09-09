import './globals.css';

export const metadata = {
  title: 'Studio ALBA | AI Video Production',
  description: 'AIで作る、伝わる縦動画。企画・台本・AI素材生成・編集まで一気通貫で制作します。',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body className="font-sans">
        <nav className="flex justify-between items-center px-[6%] py-7 border-b border-panelLine">
          <a href="/" className="font-serif text-lg tracking-wide">
            Studio<span className="text-gold">.</span>ALBA
          </a>
          <div className="flex gap-8 text-sm">
            <a href="/works" className="font-medium opacity-90 hover:opacity-100 transition-opacity">実績</a>
            <a href="/about" className="font-medium opacity-90 hover:opacity-100 transition-opacity">制作の流れ</a>
            <a href="/contact" className="font-medium opacity-90 hover:opacity-100 transition-opacity">お問い合わせ</a>
          </div>
        </nav>

        {children}

        <footer className="text-center py-7 text-xs text-muted">
          © 2026 Studio ALBA
        </footer>
      </body>
    </html>
  );
}
