-- CreateTable
CREATE TABLE `IncidentReport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `reporterId` INTEGER NOT NULL,
    `reportedUserId` INTEGER NULL,
    `spaceId` INTEGER NULL,
    `reservationId` INTEGER NULL,
    `category` ENUM('GENERAL', 'RESERVA', 'ESPACIO', 'PAGO', 'CUENTA', 'FRAUDE', 'SEGURIDAD', 'OTRO') NOT NULL DEFAULT 'GENERAL',
    `status` ENUM('OPEN', 'IN_REVIEW', 'ACTION_TAKEN', 'DISMISSED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `subject` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `assignedToId` INTEGER NULL,
    `adminNote` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,

    INDEX `IncidentReport_reporterId_idx`(`reporterId`),
    INDEX `IncidentReport_reportedUserId_idx`(`reportedUserId`),
    INDEX `IncidentReport_spaceId_idx`(`spaceId`),
    INDEX `IncidentReport_reservationId_idx`(`reservationId`),
    INDEX `IncidentReport_status_idx`(`status`),
    INDEX `IncidentReport_category_idx`(`category`),
    INDEX `IncidentReport_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IncidentReport` ADD CONSTRAINT `IncidentReport_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncidentReport` ADD CONSTRAINT `IncidentReport_reportedUserId_fkey` FOREIGN KEY (`reportedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncidentReport` ADD CONSTRAINT `IncidentReport_spaceId_fkey` FOREIGN KEY (`spaceId`) REFERENCES `Space`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncidentReport` ADD CONSTRAINT `IncidentReport_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `Reservation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncidentReport` ADD CONSTRAINT `IncidentReport_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
