import json
from wr import WordCloud
import matplotlib.pyplot as plt

# 1. Đọc dữ liệu từ file JSON đã xử lý
with open("facebook_posts_processed.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# 2. Nối tất cả nội dung các post lại thành một chuỗi dài
all_text = " ".join(post["post_content"] for post in data["data"] if "post_content" in post)

# 3. (Tùy chọn) Xóa các từ không mang nhiều ý nghĩa nếu cần
stopwords = set(WordCloud().stopwords)
stopwords.update(["em", "mình", "các", "và", "là", "thì", "đã", "vì", "khi", "nhé", "nữa", "có", "nhưng", "rồi"])

# 4. Tạo wordcloud
wordcloud = WordCloud(
    width=1200,
    height=600,
    background_color="white",
    stopwords=stopwords,
    font_path="/Library/Fonts/Arial Unicode.ttf"  # Đảm bảo hỗ trợ tiếng Việt
).generate(all_text)

# 5. Hiển thị
plt.figure(figsize=(15, 8))
plt.imshow(wordcloud, interpolation='bilinear')
plt.axis("off")
plt.title("WordCloud - Phân tích nội dung bài viết đối thủ")
plt.show()