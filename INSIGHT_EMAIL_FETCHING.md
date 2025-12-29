# Email Insight - Email Fetching Details

## 📊 How Many Emails Are Fetched

**Current Implementation:**
- **Default Limit**: Last **100 emails** per buyer_id
- **History Limit**: Last **50 emails** included in history array
- **All fetched emails**: Used for summary statistics

## 🔍 Query Details

**Location**: `email-service/src/services/dbService.ts` - `getEmailsByBuyerId()`

**Query:**
```sql
SELECT * FROM c 
WHERE (c.userId = @buyerId OR c.user_id = @buyerId) 
ORDER BY c.sent.sentAt DESC
```

**Key Points:**
- Queries both `userId` and `user_id` fields (handles old/new documents)
- Sorted by `sent.sentAt` in **DESCENDING** order (most recent first)
- Limited to 100 emails using `maxItemCount`
- Uses partition key efficiently (queries within partition)

## 📅 How Latest Email is Determined

**Location**: `email-service/src/services/emailInsightService.ts` - `generateTrackingSummary()`

**Process:**
1. Query returns emails sorted by `sent.sentAt DESC` (newest first)
2. **Latest email = `emails[0]`** (first item in sorted array)
3. Verified by logging: `sentAt` timestamp

**Code:**
```typescript
const emails = await dbService.getEmailsByBuyerId(buyerId, 100);
// emails[0] = most recent (highest sentAt timestamp)
// emails[1] = second most recent
// emails[n] = oldest in the batch

const latestEmail = emails[0]; // ✅ This is the latest
console.log(`Latest email sentAt: ${latestEmail.sent.sentAt}`);
```

## 📈 What Happens with Many Emails

### Scenario: User has 500 emails

1. **Fetch**: Gets last 100 emails (most recent)
2. **Summary Stats**: Calculated from these 100 emails
   - Total sent: 100 (or actual count in the batch)
   - Opens, replies, engagement score
3. **Latest Email**: `emails[0]` (most recent of the 100)
4. **AI Analysis**: Only analyzes the **latest email** (saves LLM costs)
5. **History**: Includes last 50 emails with insights

### Performance Considerations

**Benefits of 100 email limit:**
- ✅ Faster queries (less data to fetch)
- ✅ Lower Cosmos DB RU consumption
- ✅ Faster processing
- ✅ Recent data is most relevant for insights

**If you need more emails:**
- Can increase limit: `getEmailsByBuyerId(buyerId, 200)`
- Can remove limit entirely (not recommended for large datasets)

## 🎯 Latest Email Determination Logic

The "latest" email is determined by:

1. **Database Query**: `ORDER BY c.sent.sentAt DESC`
   - Cosmos DB sorts by `sent.sentAt` field in descending order
   - Most recent timestamp = first result

2. **Array Position**: `emails[0]`
   - Since array is sorted DESC, first element is latest
   - Verified with: `latestEmail.sent.sentAt` logging

3. **Verification**: Logs show latest email ID and timestamp

## 📋 Summary

| Aspect | Value |
|--------|-------|
| **Emails Fetched** | Last 100 (configurable) |
| **Query Sort** | `sent.sentAt DESC` (newest first) |
| **Latest Email** | `emails[0]` (first in sorted array) |
| **AI Analysis** | Only latest email analyzed |
| **History Included** | Last 50 emails |
| **Summary Stats** | Calculated from all fetched emails |

## 🔧 Adjusting Limits

To change the limits, update:
```typescript
// In emailInsightService.ts:
const emails = await dbService.getEmailsByBuyerId(buyerId, 100); // Change 100 to desired limit

// History limit (in buildEmailHistory call):
const historyEmails = emails.slice(0, 50); // Change 50 to desired history size
```

