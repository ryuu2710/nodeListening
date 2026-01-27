Chào bro, tôi đã đọc kỹ code của bro.

**Nhận xét nhanh về code hiện tại:**
Code của bro đang làm tốt nhiệm vụ **"Tìm kiếm (Search)"** trong một **"Group cụ thể"** với một **"Keyword cụ thể"**. Nó giống như bro cầm kính lúp đi soi đúng một góc nhà để tìm đồ vật vậy.

Tuy nhiên, để ra được cái Report "Tết Nguyên Nhà" của ZaloPay (nơi mà bro cần Overview cả thị trường, từ Fanpage nhà, KOLs, đến Groups đối thủ), thì luồng hiện tại đang bị "thiếu tầm nhìn".

Dưới đây là phân tích sự khác biệt và **Đề xuất luồng nghiệp vụ mới** để nâng cấp từ "Tool cào dạo" thành "Hệ thống Social Listening".

---

### 1. Phân tích điểm nghẽn của luồng hiện tại

Bro nhìn vào Input của hàm hiện tại:

```typescript
projectId, groupId, keyword

```

=> **Vấn đề:**

1. **Thiếu ngữ cảnh chiến dịch:** Bro chỉ biết cào keyword. Bro không biết keyword này là Brand (ZaloPay) hay là Game (Lắc Xì). Dẫn đến data trả về chỉ là một đống text hỗn độn, không phân loại được.
2. **Thiếu đa dạng nguồn:** Hàm này chỉ chạy `FB_GROUP_API_SEARCH`. Nhưng trong report, bro cần cào **Fanpage ZaloPay (Owned Media)** và **KOLs (Paid Media)**. Fanpage và KOLs thì không dùng tính năng "Search trong Group" được, mà phải dùng tính năng "Quét tường nhà (Timeline/Feed)".
3. **Bỏ quên Comment:** Code hiện tại tập trung lấy Post (`rawStories`). Nhưng 80% insight (yêu/ghét/spam) nằm ở **Comment**. Bro chưa có luồng đào sâu vào từng bài viết để lấy comment.

---

### 2. Đề xuất Luồng Nghiệp vụ Mới (The New Workflow)

Chúng ta sẽ chuyển tư duy từ **"Cào theo yêu cầu lẻ tẻ"** sang **"Chạy theo cấu hình Chiến dịch"**.

Luồng mới sẽ gồm 4 bước lớn: **Orchestrator (Điều phối) -> Collector (Thu thập) -> Processor (Chế biến) -> Storage (Lưu kho)**.

#### Bước 1: The Orchestrator (Bộ điều phối thông minh)

Thay vì controller gọi thẳng vào hàm scrape, bro cần một lớp ở giữa để đọc cái `Campaign Config` (cái JSON Database tôi thiết kế cho bro lúc nãy).

* **Input:** `Campaign_ID`.
* **Logic:**
1. Lấy danh sách `Monitored Sources` (List Page, Group, KOLs).
2. Lấy danh sách `Keywords` (Brand, Campaign, Competitor).
3. **Phân luồng:**
* Nếu Source là **GROUP** -> Gọi Worker A (Dùng code hiện tại của bro để Search Keyword).
* Nếu Source là **FANPAGE/KOL** -> Gọi Worker B (Cào Timeline/Feed - cái này bro chưa có, sẽ phải viết thêm).





#### Bước 2: The Collector (Thợ săn dữ liệu)

Ở đây code cũ của bro (`scrapeGroupPostsByFilterParams`) sẽ trở thành **một phần nhỏ** (Sub-module). Bro cần nâng cấp nó lên:

* **Logic nâng cấp:**
1. **Cào Post:** Như bro đang làm (OK).
2. **Cào Comment (Mới):** Với mỗi Post cào được, nếu `total_comments > 10`, bro phải kích hoạt một luồng phụ: Mở popup post đó ra, scroll để lấy nội dung comments. Report ZaloPay cần đếm xem bao nhiêu người khen/chê, nên không thể bỏ qua comment.
3. **Lấy Raw Metrics:** Đảm bảo lấy đủ `Like`, `Share`, `Comment` (bro đã làm được).



#### Bước 3: The Processor (Nhà máy chế biến - Quan trọng nhất)

Đây là bước biến "Rác" thành "Vàng". Trước khi `cleanedPosts.push()`, bro phải cho dữ liệu đi qua dây chuyền xử lý (Pipeline):

1. **Normalization (Chuẩn hóa):** Giữ nguyên code `normalizeFacebookPost` của bro.
2. **Spam Filtering (Lọc rác):**
* Check content với `exclude_keywords` (lô đề, bán sim...). Nếu dính -> Gán cờ `is_spam = true`.


3. **Tagging (Dán nhãn tự động):**
* So khớp content với `brand_keywords` -> Gán `is_brand_mention`.
* So khớp content với `topic_keywords` -> Gán `topic_tags` (VD: ["GAMI"], ["MUSIC"]).


4. **Sentiment Analysis (Phân tích cảm xúc):**
* (Tạm thời) Dùng từ điển keyword đơn giản (vui/buồn).
* (Tương lai) Gọi API OpenAI chấm điểm bài viết này.



#### Bước 4: Sync to Backend (Đồng bộ)

Thay vì trả về cục JSON khổng lồ cho Client chờ đợi (sẽ bị timeout), bro nên:

* Đẩy từng batch (ví dụ 10 bài) về API Spring Boot (`POST /api/mentions/batch`).
* Spring Boot sẽ lưu vào Postgres.

---

### 3. Sơ đồ Luồng dữ liệu (Visual Flow)

Cụ thể luồng xử lý code sẽ thay đổi như sau:

**Cũ:**
`Controller` -> `ScrapeService` (Mở browser -> Search -> Trả về JSON)

**Mới:**

1. `Controller` nhận lệnh "Start Campaign ZaloPay".
2. `CampaignService` đọc Config từ DB.
3. Vòng lặp `Sources`:
* Nếu là Group "Hội Review": Gọi `GroupSearchScraper` (Code bro đang có).
* Nếu là Fanpage "ZaloPay": Gọi `PageTimelineScraper` (Cần viết mới).


4. Trong lúc Scraper chạy:
* Có Post mới -> Chạy hàm `enrichData(post)` (Tagging, Spam check).
* Đẩy data đã enrich về Spring Boot ngay lập tức.


5. Kết thúc: Báo cáo "Done" cho người dùng.

### Tóm lại nhiệm vụ của bro:

1. **Refactor:** Đổi tên hàm hiện tại thành `scrapeGroupSearch` (để dành riêng cho việc search trong group).
2. **Enrichment:** Viết thêm logic xử lý data (Tagging, Spam filter) **ngay sau khi** `normalizeFacebookPost` và trước khi push vào mảng kết quả.
3. **Expansion:** Chuẩn bị tinh thần viết thêm hàm `scrapePageTimeline` để cào Fanpage/KOL (vì Fanpage KOL không search keyword kiểu Group được, mà phải quét bài mới nhất trên tường).

Bro thấy luồng này clear chưa? Nếu OK, tôi sẽ hướng dẫn bro sửa code hàm hiện tại để tích hợp phần **Enrichment (Xử lý data)** vào trước nhé.
