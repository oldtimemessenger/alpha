/** Count only the current account's unread activity and outstanding requests. */
export function unreadNotificationCount(notes = [], requests = [], friendRequests = [], userId) {
  if (!userId) return 0;
  return notes.filter(note => note.user === userId && !note.read).length
    + requests.filter(request => request.to === userId).length
    + friendRequests.filter(request => request.to === userId).length;
}

export function notificationBadgeMarkup(count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  return total ? `<span class="home-notification-dot home-notification-count" aria-label="${total} unread notifications">${total > 99 ? "99+" : total}</span>` : "";
}
