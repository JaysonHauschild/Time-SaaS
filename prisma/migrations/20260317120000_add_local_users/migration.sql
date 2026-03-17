-- CreateTable: local_users (source of truth for all users)
CREATE TABLE `local_users` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NULL,
    `passwordHash` TEXT NULL,
    `email` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `local_users_username_key`(`username`),
    UNIQUE INDEX `local_users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: add localUserId FK to existing User table
ALTER TABLE `User` ADD COLUMN `localUserId` VARCHAR(191) NULL;

ALTER TABLE `User` ADD UNIQUE INDEX `User_localUserId_key`(`localUserId`);

-- AddForeignKey: User.localUserId -> local_users.id
ALTER TABLE `User` ADD CONSTRAINT `User_localUserId_fkey` FOREIGN KEY (`localUserId`) REFERENCES `local_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
