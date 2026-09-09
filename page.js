const works = [
  {
    id: '01',
    title: '制作実績 01',
    desc: '縦型ショート動画',
    video: '/videos/reel-vertical.mp4',
    poster: '/videos/reel-vertical-poster.jpg',
  },
  {
    id: '02',
    title: '建築会社 PR動画',
    desc: '企画〜編集まで一貫制作',
    video: '/videos/reel-construction.mp4',
    poster: '/videos/reel-construction-poster.jpg',
  },
];

export default function Works() {
  return (
    <section className="px-[6%] py-[6%]">
      <div className="flex justify-between items-baseline border-b border-panelLine pb-5 mb-10">
        <h2 className="font-serif font-semibold text-2xl">実績一覧</h2>
        <span className="text-muted text-sm">All works</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {works.map((w) => (
          <div key={w.id}>
            <div className="aspect-video rounded-lg border border-panelLine bg-panel relative mb-3 overflow-hidden">
              <video
                src={w.video}
                poster={w.poster}
                className="w-full h-full object-cover"
                controls
                muted
                playsInline
              />
            </div>
            <h3 className="text-sm font-medium mb-1">{w.title}</h3>
            <p className="text-xs text-muted">{w.desc}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-5 bg-panel border border-panelLine rounded-lg px-7 py-6 mt-10">
        <div>
          <div className="text-xs text-muted mb-1">Instagramでも作品を公開中</div>
          <div className="text-lg font-semibold">@studioalba.jp</div>
        </div>
        <a
          href="https://www.instagram.com/studioalba.jp?stkn=a2ZzOTIxNWc3cXcw&utm_source=qr"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-gold text-ink px-6 py-3 rounded font-semibold text-sm whitespace-nowrap"
        >
          Instagramを見る
        </a>
      </div>
    </section>
  );
}
