import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProjectForm } from "@/components/project-form";

export const metadata: Metadata = { title: "新しいプロジェクト" };

export default function NewProjectPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ChevronLeft className="size-4" />
        プロジェクト一覧
      </Link>
      <h1 className="text-xl font-semibold">新しいプロジェクト</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">
        案件の基本情報と台本を入力します。台本は作成後に「AIで解析」するとカット表になります。
      </p>
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <ProjectForm />
      </div>
    </main>
  );
}
