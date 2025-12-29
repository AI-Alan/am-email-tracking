# Message ID Saving and Update Verification

## ✅ Email Service - Saving Message ID

**Location**: `email-service/src/services/emailService.ts`

**When email is sent:**
```typescript
const emailLog: EmailTracking = {
  id: messageId,  // ✅ MessageId is saved as the document 'id' field
  userId: recipient.user_id || recipient.email,  // ✅ Used as partition key
  // ... other fields
};
await dbService.saveTrackingData(emailLog);
```

**Verification**: 
- ✅ MessageId (UUID) is saved as `id` field in Cosmos DB
- ✅ UserId is saved and used as partition key
- ✅ Document is created with correct structure

## ✅ Tracking Service - Updating on Email Open

**Location**: `tracking-service/src/services/openTrackingHandler.ts`

**When email is opened:**
```typescript
// 1. Query by messageId (which is the document id)
const query = `SELECT * FROM c WHERE c.id = @messageId`;
const { resources } = await container.items.query({...}).fetchAll();

// 2. Get the document
const resource: EmailTracking = resources[0];

// 3. Update open tracking fields
updates.push({ op: "set", path: "/open/openCount", value: newOpenCount });
updates.push({ op: "set", path: "/open/firstOpenedAt", value: now });
updates.push({ op: "set", path: "/open/lastOpenedAt", value: now });
updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.OPENED });

// 4. Patch the document using resource.id (messageId) and resource.userId (partition key)
await container.item(resource.id, resource.userId).patch(updates);
```

**Verification**:
- ✅ Query finds document by `id = messageId`
- ✅ Uses `resource.id` (messageId) and `resource.userId` (partition key) to patch
- ✅ Updates `open.openCount`, `open.firstOpenedAt`, `open.lastOpenedAt`
- ✅ Updates `lifecycleStatus` to OPENED

## Data Flow

1. **Email Sent**:
   - Generate UUID: `f0b43838-c2d5-4784-b0f3-a2f27d71ab5a`
   - Save to DB: `{ id: "f0b43838...", userId: "amorphious", ... }`

2. **Email Opened**:
   - Tracking pixel calls: `/open/f0b43838-c2d5-4784-b0f3-a2f27d71ab5a.png`
   - Query: `WHERE c.id = "f0b43838..."`
   - Update: Patch document using `id` and `userId`

## Both Are Fixed ✅

- ✅ Message ID is saved correctly as `id` field
- ✅ Tracking service finds document by `id = messageId`
- ✅ Updates are applied using correct `id` and `userId` (partition key)
- ✅ Open tracking fields are updated correctly

