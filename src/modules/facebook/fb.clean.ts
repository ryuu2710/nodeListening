import { url } from "inspector";
import { SocialFbMention, SocialFbComment } from "./fb.types";

function getSafe<T>(obj: any, ...paths: (string | number)[][]): T | undefined {
  for (const path of paths) {
    let current = obj;
    let valid = true;
    for (const key of path) {
      if (current === null || current === undefined) {
        valid = false;
        break;
      }
      current = current[key];
    }
    if (valid && current !== undefined && current !== null) return current as T;
  }
  return undefined;
}

export function extractPostsFromRawJson(json: any): any[] {
  const results: any[] = [];

  // CASE A: Group Feed
  if (json?.data?.node?.group_feed?.edges) {
    json.data.node.group_feed.edges.forEach((edge: any) => {
      if (edge.node) results.push(edge.node);
    });
  }

  // CASE B: Search Results
  else if (json?.data?.serpResponse?.results?.edges) {
    json.data.serpResponse.results.edges.forEach((edge: any) => {
      const story = getSafe(edge, [
        "rendering_strategy",
        "view_model",
        "click_model",
        "story",
      ]);
      if (story) results.push(story);
    });
  }

  return results;
}

export function normalizeFacebookPost(node: any): SocialFbMention | null {
  if (!node) return null;

  // ID & URL
  const id = getSafe<string>(node, ["post_id"], ["id"]);
  if (!id) return null;

  const url =
    getSafe<string>(
      node,
      ["comet_sections", "content", "story", "wwwURL"],
      ["shareable_from_perspective_of_feed_ufi", "url"],
    ) ?? `https://facebook.com/${id}`;

  // Content
  const content =
    getSafe<string>(
      node,
      ["comet_sections", "content", "story", "message", "text"],
      ["message", "text"],
    ) ?? "";

  // Author (Handle case Anonymous)
  const actors =
    getSafe<any[]>(
      node,
      ["comet_sections", "content", "story", "actors"],
      ["actors"],
    ) ?? [];
  const firstActor = actors[0] || {};
  const author: any = {
    id: firstActor.id ?? "unknown",
    name: firstActor.name ?? "Unknown",
    is_anonymous: firstActor.__typename === "GroupAnonAuthorProfile",
  };

  // Stats & Reactions
  const feedback = getSafe<any>(node, [
    "comet_sections",
    "feedback",
    "story",
    "feedback_context",
    "feedback_target_with_context",
    "comet_ufi_summary_and_actions_renderer",
    "feedback",
  ]);

  const stats: any = {
    likes: Number(getSafe(feedback, ["reaction_count", "count"]) ?? 0),
    comments: Number(
      getSafe(node, [
        "comet_sections",
        "feedback",
        "story",
        "story_ufi_container",
        "story",
        "feedback_context",
        "feedback_target_with_context",
        "comet_ufi_summary_and_actions_renderer",
        "feedback",
        "comment_rendering_instance",
        "comments",
        "total_count",
      ]) ?? 0,
    ),
    shares: Number(
      getSafe(node, [
        "comet_sections",
        "feedback",
        "story",
        "story_ufi_container",
        "story",
        "feedback_context",
        "feedback_target_with_context",
        "comet_ufi_summary_and_actions_renderer",
        "feedback",
        "share_count",
        "count",
      ]) ?? 0,
    ),
    reaction_breakdown: {} as Record<string, number>,
  };

  // Map reaction breakdown
  const reactionEdges =
    getSafe<any[]>(node, [
      "comet_sections",
      "feedback",
      "story",
      "story_ufi_container",
      "story",
      "feedback_context",
      "feedback_target_with_context",
      "comet_ufi_summary_and_actions_renderer",
      "feedback",
      "top_reactions",
      "edges",
    ]) ?? [];
  reactionEdges.forEach((edge: any) => {
    const type = edge?.node?.localized_name?.toLowerCase(); // "like", "love"
    const count = edge?.reaction_count || 0;
    if (type && count > 0) {
      stats.reaction_breakdown[type] = count;
    }
  });

  // Timestamp
  const ts =
    getSafe<number>(
      node,
      [
        "comet_sections",
        "context_layout",
        "story",
        "comet_sections",
        "metadata",
        0,
        "story",
        "creation_time",
      ],
      ["creation_time"],
    ) ?? Math.floor(Date.now() / 1000);

  return {
    id,
    url,
    content,
    authorMock: author,
    stats,
    createdAtTs: ts,
    publishedAt: new Date(),
  };
}

// Helper to decode Base64 ID (Ex: "S:_I100...:123..." -> "123...")
function extractPostIdFromBase64(base64Id: string): string {
  try {
    const decoded = Buffer.from(base64Id, "base64").toString("utf8");
    const parts = decoded.split(":");
    return parts[parts.length - 1];
  } catch (e) {
    return base64Id; // Fallback
  }
}

export function extractFanpagePostsFromRawJson(
  json: any,
  isVerified: boolean,
): SocialFbMention[] {
  const edges = json?.data?.node?.timeline_list_feed_units?.edges;
  const userId: string = json?.data?.node?.id;
  // data.node.timeline_list_feed_units.edges[0].node.post_id
  if (!Array.isArray(edges)) return [];
  // const postId = json.data.node.timeline_list_feed_units.edges[0].node.post_id;

  return edges
    .map((edge: any) => {
      const node = edge.node;
      if (!node) return null;

      // data.node.timeline_list_feed_units.edges[0].node.feedback.owning_profile.name
      const username =
        node.feedback.owning_profile.name ||
        node.feedback.owning_profile.short_name ||
        "";

      // Share/Memory
      const timeFromContext =
        node.comet_sections?.context_layout?.story?.comet_sections
          ?.metadata?.[0]?.story?.creation_time;
      // normal post
      const timeFromTimestamp =
        node.comet_sections?.timestamp?.story?.creation_time;
      // old fallback
      const timeFromLegacy =
        node.creation_time || node.story_extra_info?.publish_time;

      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback.top_reactions
      const topReactionEdges: any[] =
        node.comet_sections.feedback.story.story_ufi_container.story
          .feedback_context.feedback_target_with_context
          .comet_ufi_summary_and_actions_renderer.feedback.top_reactions.edges;
      const likeVal: number =
        topReactionEdges.find(
          (edge: any) => edge.node.localized_name === "Like",
        )?.reaction_count || 0;

      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback.comments_count_summary_renderer.feedback.comment_rendering_instance.comments.total_count
      const commentsCount: number =
        node.comet_sections.feedback.story.story_ufi_container.story
          .feedback_context.feedback_target_with_context
          .comet_ufi_summary_and_actions_renderer.feedback
          .comments_count_summary_renderer.feedback.comment_rendering_instance
          .comments.total_count ||
        node.comet_sections.feedback.story.story_ufi_container.story
          .feedback_context.feedback_target_with_context
          .comet_ufi_summary_and_actions_renderer.feedback
          .comment_rendering_instance.comments.total_count ||
        node.comet_sections.feedback.story.story_ufi_container.story
          .feedback_context.feedback_target_with_context
          .comment_rendering_instance.comments.total_count ||
        0;

      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.comet_ufi_summary_and_actions_renderer.feedback.share_count.count
      const shareCount: number =
        node.comet_sections.feedback.story.story_ufi_container.story
          .feedback_context.feedback_target_with_context
          .comet_ufi_summary_and_actions_renderer.feedback.share_count.count ||
        0;
      const reactionBreakdown: Record<string, number> = topReactionEdges.reduce(
        (acc, reactionEdge) => {
          const reactionKey = reactionEdge.node.localized_name;
          const reactionVal = Number(reactionEdge.reaction_count || 0);

          acc[reactionKey] = reactionVal;
          return acc;
        },
        {} as Record<string, number>,
      );

      // Path 1 -> Path 2 -> Path 3 -> 0
      const rawTime =
        timeFromContext || timeFromTimestamp || timeFromLegacy || 0;

      // data.node.timeline_list_feed_units.edges[0].node.attachments[0].styles.attachment.media.permalink_url
      // data.node.timeline_list_feed_units.edges[0].node.attachments[0].styles.attachment.style_infos[0].containing_story.attachments[0].media.permalink_url
      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.content.story.attachments[0].styles.attachment.media.permalink_url
      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.content.story.attachments[0].styles.attachment.style_infos[0].containing_story.attachments[0].media.permalink_url
      // data.node.timeline_list_feed_units.edges[0].node.permalink_url
      const permanentURL =
        node.permalink_url ||
        node.attachments[0].styles.attachment.media.permalink_url ||
        node.attachments[0].styles.attachment.style_infos[0].containing_story
          .attachments[0].media.permalink_url ||
        node.comet_sections.content.story.attachments[0].styles.attachment.media
          .permalink_url ||
        node.comet_sections.content.story.attachments[0].styles.attachment
          .style_infos[0].containing_story.attachments[0].media.permalink_url;
      console.log(`\nPermanent link: ${permanentURL}`);

      // data.node.timeline_list_feed_units.edges[0].node.post_id
      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.content.story.post_id
      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.feedback.story.story_ufi_container.story.feedback_context.feedback_target_with_context.plugins[0].post_id
      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.feedback.story.story_ufi_container.story.feedback_context.interesting_top_level_comments[0].comment.feedback.plugins[0].post_id
      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.feedback.story.story_ufi_container.story.shareable_from_perspective_of_feed_ufi.post_id
      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.feedback.story.story_ufi_container.story.post_id
      const prePostId =
        node.post_id ||
        node.comet_sections.content.story.post_id ||
        node.comet_sections.feedback.story.story_ufi_container.story
          .feedback_context.feedback_target_with_context.plugins[0].post_id ||
        node.comet_sections.feedback.story.story_ufi_container.story
          .feedback_context.interesting_top_level_comments[0].comment.feedback
          .plugins[0].post_id ||
        node.comet_sections.feedback.story.story_ufi_container.story
          .shareable_from_perspective_of_feed_ufi.post_id ||
        node.comet_sections.feedback.story.story_ufi_container.story.post_id ||
        "";

      // data.node.timeline_list_feed_units.edges[0].node.comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0].profile_url
      let profileUrl =
        node.comet_sections.context_layout.story.comet_sections.actor_photo
          .story.actors[0].profile_url || "";

      return {
        id: prePostId,
        url: permanentURL,
        content:
          node.message?.text ||
          node.comet_sections?.content?.story?.message?.text ||
          "",
        author: {
          id: userId,
          name: username,
          url: profileUrl,
          isVerified,
        },
        attachments: [{}],
        stats: {
          likes: likeVal,
          comments: commentsCount,
          shares: shareCount,
          reactionBreakdown,
        },
        publishedAt: new Date(rawTime * 1000),
      } as SocialFbMention;
    })
    .filter((p) => p !== null);
}

export function extractCommentFromRawJson(
  json: any,
  parentPostId?: string,
): SocialFbComment[] {
  const edges =
    json?.data?.node?.comment_rendering_instance_for_feed_location?.comments
      ?.edges;
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges
    .map((edge: any) => {
      const node = edge.node;
      const postId = node.feedback.plugins[0].post_id || "";
      if (!node) return null;

      const commentURL = node.feedback.url;
      const postURL = getCleanReelUrl(commentURL);

      return {
        id: node.legacy_fbid || node.id,
        content: node.body?.text || "",
        postId,
        postURL,
        commentURL,
        author: {
          id: node.author?.id,
          name: node.author?.name,
          avatar: node.author?.profile_picture_depth_0?.uri || "",
          url: node.author?.url,
        },
        stats: {
          likes: parseInt(node.feedback?.reactors?.count || "0"),
          replies: parseInt(node.feedback?.replies_fields?.total_count || "0"),
        },
        publishedAt: new Date((node.created_time || 0) * 1000),
      } as SocialFbComment;
    })
    .filter((c) => c !== null) as SocialFbComment[];
}

/**
 * Helper lấy Clean URL, loại bỏ query params
 * @param urlString - Link gốc (VD: https://.../?comment_id=123)
 * @returns Link sạch (VD: https://.../)
 */
export const getCleanReelUrl = (urlString: string): string => {
  try {
    const url = new URL(urlString);
    url.search = "";

    return url.toString();
  } catch (error) {
    console.warn("Invalid URL format, falling back to split");
    return urlString.split("?")[0];
  }
};
