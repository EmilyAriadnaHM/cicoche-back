-- CreateTable
CREATE TABLE `ChatReadState` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservationId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `lastReadMessageId` INTEGER NULL,
    `lastReadAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChatReadState_reservationId_idx`(`reservationId`),
    INDEX `ChatReadState_userId_idx`(`userId`),
    UNIQUE INDEX `ChatReadState_reservationId_userId_key`(`reservationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChatReadState` ADD CONSTRAINT `ChatReadState_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `Reservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatReadState` ADD CONSTRAINT `ChatReadState_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
