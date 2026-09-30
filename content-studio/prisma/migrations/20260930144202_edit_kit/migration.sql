-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "bgmFileName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bgmKey" TEXT,
ADD COLUMN     "bgmMimeType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bgmSize" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "narration" TEXT NOT NULL DEFAULT '';
