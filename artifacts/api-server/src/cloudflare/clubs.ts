import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, blocked, body, json, publicDetails, rows, type Database } from "./runtime";

export const CLUB_COVER_PRESET_IDS = [
  "marbled-red", "minimal-mesh", "misty-forest", "urban-motion", "fluid-fusion",
  "concert-crowd", "creator-desk", "faithful-rays", "geometric-glass", "warm-grid",
  "love-letters", "love-together", "sex-intimacy", "faith-light", "gods-grace",
  "quiet-prayer", "tech-circuit", "code-studio", "basketball-court", "courtside",
  "music-night", "creator-studio",
] as const;

const CreateClubBody = z.object({
  name: z.string().trim().max(48).optional().default("").transform((value) => value || "New Club"),
  topic: z.string().trim().max(48).optional().default("").transform((value) => value || "General"),
  description: z.string().trim().max(400).optional().default(""),
  privacy: z.enum(["public", "request_to_join"]).default("public"),
  coverPresetId: z.enum(CLUB_COVER_PRESET_IDS).optional(),
  coverMediaId: z.string().uuid().optional(),
}).refine((input) => !(input.coverPresetId && input.coverMediaId), {
  message: "Choose a preset cover or upload your own, not both.",
});

const CreateMessageBody = z.object({
  id: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
}).strict();

const UpdateClubCoverBody = z.object({
  coverPresetId: z.enum(CLUB_COVER_PRESET_IDS).optional(),
  coverMediaId: z.string().uuid().optional(),
}).refine((input) => Boolean(input.coverPresetId) !== Boolean(input.coverMediaId), {
  message: "Choose one Club cover.",
});

const DeleteClubBody = z.object({
  confirmation: z.string().trim().max(48),
});

const ClubRequestDecision = z.object({
  decision: z.enum(["approve", "decline"]),
}).strict();

type ClubRow = {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string;
  topic: string;
  privacy: "public" | "request_to_join" | "private";
  created_at: number;
  cover_preset_id: string | null;
  cover_media_id: string | null;
  member_count?: number;
  membership_status?: "active" | "pending" | "invited" | null;
  membership_role?: "owner" | "admin" | "moderator" | "member" | null;
  owner_username: string;
  owner_display_name: string;
  owner_data: string | null;
};

type MemberRow = {
  user_id: string;
  role: "owner" | "admin" | "moderator" | "member";
  status: "active" | "pending" | "invited";
};

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  data: string | null;
};

function clubDto(row: ClubRow, members: ProfileRow[] = []) {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    description: row.description,
    privacy: row.privacy,
    coverPresetId: row.cover_preset_id ?? null,
    coverMediaReference: row.cover_media_id ? `oldtime-media:${row.cover_media_id}` : null,
    memberCount: Number(row.member_count ?? 0),
    membershipStatus: row.membership_status ?? null,
    membershipRole: row.membership_role ?? null,
    owner: {
      id: row.owner_id,
      username: row.owner_username,
      displayName: row.owner_display_name,
      ...publicDetails(row.owner_data),
    },
    members: members.map((member) => ({
      id: member.id,
      username: member.username,
      displayName: member.display_name,
      ...publicDetails(member.data),
    })),
  };
}

async function listClubs(db: Database, userId: string) {
  const clubs = await rows<ClubRow>(db, `
    SELECT c.id,c.owner_id,c.slug,c.name,c.description,c.topic,c.privacy,c.created_at,
      c.cover_preset_id,c.cover_media_id,
      (SELECT count(*) FROM club_members active
        WHERE active.club_id=c.id AND active.status='active') AS member_count,
      (SELECT own.status FROM club_members own
        WHERE own.club_id=c.id AND own.user_id=?) AS membership_status,
      (SELECT own.role FROM club_members own
        WHERE own.club_id=c.id AND own.user_id=?) AS membership_role,
      owner.username AS owner_username,owner.display_name AS owner_display_name,owner_state.data AS owner_data
    FROM clubs c
    JOIN users owner ON owner.id=c.owner_id AND owner.is_virtual=0
    LEFT JOIN account_state owner_state ON owner_state.user_id=owner.id
    WHERE c.status='active'
      AND (c.privacy IN ('public','request_to_join') OR EXISTS(
        SELECT 1 FROM club_members own WHERE own.club_id=c.id AND own.user_id=?))
      AND NOT EXISTS(SELECT 1 FROM account_blocks b
        WHERE (b.owner_id=? AND b.blocked_id=c.owner_id)
           OR (b.owner_id=c.owner_id AND b.blocked_id=?))
    ORDER BY CASE WHEN membership_status='active' THEN 0 ELSE 1 END,
      c.topic COLLATE NOCASE,c.name COLLATE NOCASE
    LIMIT 100`, userId, userId, userId, userId, userId);

  if (!clubs.length) return { clubs: [] };
  const ids = clubs.map((club) => club.id);
  const placeholders = ids.map(() => "?").join(",");
  const members = await rows<ProfileRow & { club_id: string }>(db, `
    SELECT club_members.club_id,u.id,u.username,u.display_name,account_state.data
    FROM club_members
    JOIN users u ON u.id=club_members.user_id AND u.is_virtual=0
    LEFT JOIN account_state ON account_state.user_id=u.id
    WHERE club_members.club_id IN (${placeholders}) AND club_members.status='active'
      AND (u.is_private=0 OR u.id=? OR EXISTS(
        SELECT 1 FROM user_follows f WHERE f.follower_id=? AND f.followed_id=u.id))
      AND NOT EXISTS(SELECT 1 FROM account_blocks b
        WHERE (b.owner_id=? AND b.blocked_id=u.id) OR (b.owner_id=u.id AND b.blocked_id=?))
    ORDER BY club_members.created_at,club_members.user_id`, ...ids, userId, userId, userId, userId);
  const membersByClub = new Map<string, ProfileRow[]>();
  for (const member of members) {
    const list = membersByClub.get(member.club_id) ?? [];
    if (list.length < 3) list.push(member);
    membersByClub.set(member.club_id, list);
  }
  return { clubs: clubs.map((club) => clubDto(club, membersByClub.get(club.id) ?? [])) };
}

async function findClub(db: Database, userId: string, clubId: string): Promise<ClubRow> {
  const club = await db.prepare(`
    SELECT c.id,c.owner_id,c.slug,c.name,c.description,c.topic,c.privacy,c.created_at,
      c.cover_preset_id,c.cover_media_id,
      (SELECT count(*) FROM club_members active
        WHERE active.club_id=c.id AND active.status='active') AS member_count,
      (SELECT own.status FROM club_members own
        WHERE own.club_id=c.id AND own.user_id=?) AS membership_status,
      (SELECT own.role FROM club_members own
        WHERE own.club_id=c.id AND own.user_id=?) AS membership_role,
      owner.username AS owner_username,owner.display_name AS owner_display_name,owner_state.data AS owner_data
    FROM clubs c
    JOIN users owner ON owner.id=c.owner_id AND owner.is_virtual=0
    LEFT JOIN account_state owner_state ON owner_state.user_id=owner.id
    WHERE c.id=? AND c.status='active'
      AND (c.privacy IN ('public','request_to_join') OR EXISTS(
        SELECT 1 FROM club_members own WHERE own.club_id=c.id AND own.user_id=?))
    LIMIT 1`).bind(userId, userId, clubId, userId).first<ClubRow>();
  if (!club || await blocked(db, userId, club.owner_id)) throw new ApiError(404, "Club not found.");
  return club;
}

async function activeMember(db: Database, clubId: string, userId: string): Promise<MemberRow> {
  const member = await db.prepare(
    "SELECT user_id,role,status FROM club_members WHERE club_id=? AND user_id=? AND status='active'",
  ).bind(clubId, userId).first<MemberRow>();
  if (!member) throw new ApiError(403, "Join this Club to open its chat.");
  return member;
}

async function loadMessages(db: Database, clubId: string, userId: string, after?: string | null) {
  const cursorMatch = after ? /^(\d{1,16}):([a-f0-9-]{36})$/i.exec(after) : null;
  if (after && !cursorMatch) throw new ApiError(400, "Refresh the Club chat and try again.");
  const cursorTime = cursorMatch ? Number(cursorMatch[1]) : null;
  const cursorId = cursorMatch?.[2] ?? null;
  const found = await rows<{
      id: string; body: string; created_at: number; author_id: string;
      username: string; display_name: string; data: string | null;
    }>(db, `SELECT m.id,m.body,m.created_at,m.author_id,u.username,u.display_name,s.data
      FROM club_chat_messages m JOIN users u ON u.id=m.author_id
      LEFT JOIN account_state s ON s.user_id=u.id
      WHERE m.club_id=? ${cursorMatch ? "AND (m.created_at>? OR (m.created_at=? AND m.id>?))" : ""}
        AND NOT EXISTS(SELECT 1 FROM account_blocks b
        WHERE (b.owner_id=? AND b.blocked_id=m.author_id)
           OR (b.owner_id=m.author_id AND b.blocked_id=?))
      ORDER BY m.created_at ${cursorMatch ? "ASC" : "DESC"},m.id ${cursorMatch ? "ASC" : "DESC"} LIMIT 60`,
    clubId,
    ...(cursorMatch ? [cursorTime, cursorTime, cursorId] : []),
    userId, userId,
  );
  if (!cursorMatch) found.reverse();
  const messages = found.map((message) => ({
    id: message.id,
    body: message.body,
    createdAt: message.created_at,
    author: {
      id: message.author_id,
      username: message.username,
      displayName: message.display_name,
      ...publicDetails(message.data),
    },
  }));
  const last = found[found.length - 1];
  return {
    messages,
    cursor: last ? `${last.created_at}:${last.id}` : after ?? null,
  };
}

async function listRequests(db: Database, clubId: string) {
  return rows<ProfileRow & { created_at: number }>(db, `
    SELECT u.id,u.username,u.display_name,s.data,member.created_at
    FROM club_members member
    JOIN users u ON u.id=member.user_id AND u.is_virtual=0
    LEFT JOIN account_state s ON s.user_id=u.id
    WHERE member.club_id=? AND member.status='pending'
    ORDER BY member.created_at,member.user_id LIMIT 100`, clubId);
}

async function clubRequestBody(request: Request) {
  const parsed = CreateClubBody.safeParse(await body(request));
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter(Boolean))];
    const message = fields.length
      ? `Check these Club details: ${fields.join(", ")}.`
      : parsed.error.issues[0]?.message ?? "Check the Club details and try again.";
    throw new ApiError(400, message);
  }
  return parsed.data;
}

export function isClubPath(path: string) {
  return path === "/clubs" || path.startsWith("/clubs/");
}

export async function clubRequest(
  request: Request,
  db: Database,
  userId: string,
  path: string,
): Promise<Response> {
  if (path === "/clubs" && request.method === "GET") return json(await listClubs(db, userId));

  if (path === "/clubs" && request.method === "POST") {
    const input = await clubRequestBody(request);
    if (input.coverMediaId) {
      const cover = await db.prepare(`SELECT id FROM user_media_assets
        WHERE id=? AND user_id=? AND ready=1 AND storage_scope='public'
          AND media_role='media' AND content_type IN ('image/jpeg','image/png','image/webp','image/gif','image/avif')
        LIMIT 1`).bind(input.coverMediaId, userId).first<{ id: string }>();
      if (!cover) throw new ApiError(400, "Choose a confirmed image from your account for the Club cover.");
    }
    const id = randomUUID();
    const now = Date.now();
    const slug = `${input.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "club"}-${id.slice(0, 8)}`;
    await db.batch([
      db.prepare(`INSERT INTO clubs(id,owner_id,slug,name,description,topic,privacy,
        cover_preset_id,cover_media_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
        id, userId, slug, input.name, input.description, input.topic, input.privacy,
        input.coverPresetId ?? null, input.coverMediaId ?? null, now, now,
      ),
      db.prepare(`INSERT INTO club_members(club_id,user_id,role,status,created_at,updated_at)
        VALUES(?,?,'owner','active',?,?)`).bind(id, userId, now, now),
    ]);
    return json({ club: clubDto(await findClub(db, userId, id)) }, 201);
  }

  const match = /^\/clubs\/([a-f0-9-]{36})(?:\/(join|leave|messages|requests|cover)(?:\/([a-f0-9-]{36}))?)?$/i.exec(path);
  if (!match) throw new ApiError(404, "Club not found.");
  const [, clubId, action, memberId] = match;
  const club = await findClub(db, userId, clubId);

  if (!action && request.method === "GET") return json({ club: clubDto(club) });

  if (!action && request.method === "DELETE") {
    if (club.owner_id !== userId) throw new ApiError(403, "Only the Club creator can delete this group chat.");
    const parsed = DeleteClubBody.safeParse(await body(request));
    if (!parsed.success || parsed.data.confirmation !== club.name) {
      throw new ApiError(400, "Type the Club name exactly to delete its shared chat.");
    }
    await db.prepare("DELETE FROM clubs WHERE id=? AND owner_id=? AND status='active'")
      .bind(clubId, userId).run();
    return json({ deleted: true });
  }

  if (action === "cover" && request.method === "PATCH") {
    if (club.owner_id !== userId) throw new ApiError(403, "Only the Club creator can change its cover.");
    const parsed = UpdateClubCoverBody.safeParse(await body(request));
    if (!parsed.success) throw new ApiError(400, "Choose one valid preset or a confirmed image from your account.");
    const coverMediaId = parsed.data.coverMediaId;
    if (coverMediaId) {
      const cover = await db.prepare(`SELECT id FROM user_media_assets
        WHERE id=? AND user_id=? AND ready=1 AND storage_scope='public'
          AND media_role='media' AND content_type IN ('image/jpeg','image/png','image/webp','image/gif','image/avif')
        LIMIT 1`).bind(coverMediaId, userId).first<{ id: string }>();
      if (!cover) throw new ApiError(400, "Choose a confirmed image from your account for the Club cover.");
    }
    await db.prepare(`UPDATE clubs SET cover_preset_id=?,cover_media_id=?,updated_at=?
      WHERE id=? AND owner_id=? AND status='active'`)
      .bind(parsed.data.coverPresetId ?? null, coverMediaId ?? null, Date.now(), clubId, userId).run();
    return json({ club: clubDto(await findClub(db, userId, clubId)) });
  }

  if (action === "join" && request.method === "POST") {
    const existing = await db.prepare(
      "SELECT status,role FROM club_members WHERE club_id=? AND user_id=?",
    ).bind(clubId, userId).first<MemberRow>();
    if (existing?.status === "active") return json({ status: "active" });
    if (existing?.status === "pending") return json({ status: "pending" });
    if (club.privacy === "private" && existing?.status !== "invited") {
      throw new ApiError(404, "Club not found.");
    }
    const status = club.privacy === "public" || existing?.status === "invited" ? "active" : "pending";
    await db.prepare(`INSERT INTO club_members(club_id,user_id,role,status,created_at,updated_at)
      VALUES(?,?,'member',?,?,?)
      ON CONFLICT(club_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`)
      .bind(clubId, userId, status, Date.now(), Date.now()).run();
    return json({ status });
  }

  if (action === "leave" && request.method === "POST") {
    const member = await db.prepare(
      "SELECT role FROM club_members WHERE club_id=? AND user_id=? AND status='active'",
    ).bind(clubId, userId).first<{ role: string }>();
    if (!member) return json({ status: "not_member" });
    if (member.role === "owner") throw new ApiError(400, "The Club owner cannot leave their own Club.");
    await db.prepare("DELETE FROM club_members WHERE club_id=? AND user_id=?").bind(clubId, userId).run();
    return json({ status: "left" });
  }

  if (action === "messages") {
    await activeMember(db, clubId, userId);
    if (request.method === "GET" && !memberId) {
      return json(await loadMessages(db, clubId, userId, new URL(request.url).searchParams.get("after")));
    }
    if (request.method === "POST" && !memberId) {
      const parsed = CreateMessageBody.safeParse(await body(request));
      if (!parsed.success) throw new ApiError(400, "Write a message of 1–2000 characters.");
      const existing = await db.prepare("SELECT club_id,author_id FROM club_chat_messages WHERE id=?")
        .bind(parsed.data.id).first<{ club_id: string; author_id: string }>();
      if (existing && (existing.club_id !== clubId || existing.author_id !== userId)) {
        throw new ApiError(409, "That message ID is already in use.");
      }
      if (!existing) {
        await db.prepare(`INSERT INTO club_chat_messages(id,club_id,author_id,body,created_at)
          VALUES(?,?,?,?,MAX(?,COALESCE((SELECT MAX(created_at)+1 FROM club_chat_messages WHERE club_id=?),0)))`)
          .bind(parsed.data.id, clubId, userId, parsed.data.body, Date.now(), clubId).run();
      }
      const messagePage = await loadMessages(db, clubId, userId);
      const message = messagePage.messages.find((item) => item.id === parsed.data.id);
      if (!message) throw new ApiError(500, "The message could not be loaded.");
      return json({ message }, existing ? 200 : 201);
    }
  }

  if (action === "requests" && !memberId && request.method === "GET") {
    const member = await activeMember(db, clubId, userId);
    if (!["owner", "admin"].includes(member.role)) throw new ApiError(403, "Only Club admins can review requests.");
    const requests = await listRequests(db, clubId);
    return json({ requests: requests.map((request) => ({
      id: request.id,
      username: request.username,
      displayName: request.display_name,
      ...publicDetails(request.data),
    })) });
  }

  if (action === "requests" && memberId && request.method === "POST") {
    const member = await activeMember(db, clubId, userId);
    if (!["owner", "admin"].includes(member.role)) throw new ApiError(403, "Only Club admins can review requests.");
    const parsed = ClubRequestDecision.safeParse(await body(request));
    if (!parsed.success) throw new ApiError(400, "Choose whether to approve or decline this request.");
    if (parsed.data.decision === "approve") {
      const updated = await db.prepare(`UPDATE club_members SET status='active',updated_at=?
        WHERE club_id=? AND user_id=? AND status='pending' RETURNING user_id`)
        .bind(Date.now(), clubId, memberId).first();
      if (!updated) throw new ApiError(404, "Join request not found.");
    } else {
      const removed = await db.prepare(`DELETE FROM club_members
        WHERE club_id=? AND user_id=? AND status='pending' RETURNING user_id`)
        .bind(clubId, memberId).first();
      if (!removed) throw new ApiError(404, "Join request not found.");
    }
    return json({ status: parsed.data.decision === "approve" ? "active" : "declined" });
  }

  throw new ApiError(404, "Club action not found.");
}
