-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "inputPages" INTEGER NOT NULL,
    "outputPages" INTEGER NOT NULL,
    "inputBytes" INTEGER NOT NULL,
    "outputBytes" INTEGER NOT NULL,
    "inkSavedPct" INTEGER NOT NULL DEFAULT 0,
    "colorMode" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PresetShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

