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
    author,
    stats,
    createdAtTs: ts,
  };
}

export function extractCommentFromRawJson(json: any): SocialFbComment[] {
  const edges =
    json?.data?.node?.comment_rendering_instance_for_feed_location?.comments
      ?.edges;
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges
    .map((edge: any) => {
      const node = edge.node;
      if (!node) return null;

      return {
      id: node.legacy_fbid || node.id,
        content: node.body?.text || "",
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
      };
    })
    .filter((c) => c !== null) as SocialFbComment[];
}
