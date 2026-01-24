-- AlterTable
ALTER TABLE `document` ADD COLUMN `verifiedAt` DATETIME(3) NULL,
    ADD COLUMN `verifiedById` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Document_userId_kind_idx` ON `Document`(`userId`, `kind`);

-- CreateIndex
CREATE INDEX `Document_verified_idx` ON `Document`(`verified`);

-- CreateIndex
CREATE INDEX `Document_verifiedById_idx` ON `Document`(`verifiedById`);

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
