// The owner's invite dialog: the room's open links as the server lists them (or as an
// answer just carried them), each with its link where this browser made it, and the form
// for a new one (invitedialog.js, which loads with its first opening). Anyone else is told
// who can invite (invitePicker). Each listing drawn counts, so a slower one asked for before
// a link was made or revoked does not draw over that change.
import { t } from '../i18n.js';
import { escape as esc } from '../model.js';
import { icon } from '../icons.js';
import { address } from '../routes.js';
import { rememberInvite, forgetInvite } from '../invites.js';
import { state, storage } from './state.js';
import { pb, send, manager } from './server.js';
import { modal, closeModal, ask, toast, signInPrompt } from './ui.js';
import { onData, onAction, onSubmit } from './actions.js';
import { invitesPart } from './parts.js';
import { roleName } from './shell.js';
import { go } from './router.js';

let inviteDraws = 0;
export async function inviteDialog(listed) {
  if (state.demo)
    return signInPrompt(t('This workspace uses sample data. Sign in with Discord to create a persistent room.'));
  if (!pb.authStore.isValid) return signInPrompt(t('Sign in with Discord to create a room and invite your friends.'));
  if (!state.room || !manager()) return invitePicker();
  // The dialog (invitedialog.js) loads with its first opening.
  const dialog = await invitesPart();
  if (!state.room || !manager()) return;
  const id = state.room.id,
    now = Date.now() + state.serverOffset,
    draw = ++inviteDraws,
    askedAt = Date.now();
  modal(
    t('Invite another Discord account'),
    dialog.inviteDialogBody(listed ? dialog.withCodes(storage, id, listed, now) : null, address('/'), now),
  );
  if (listed) return;
  const answer = (await pb.send('/api/odyle/invites/' + id)).invites;
  if (draw === inviteDraws) drawInvites(id, answer, askedAt);
}
function drawInvites(id, listed, since) {
  const slot = document.querySelector('#modal[open] .invite-list'),
    now = Date.now() + state.serverOffset,
    dialog = invitesPart.loaded();
  inviteDraws++;
  if (slot && dialog && state.room?.id === id)
    slot.innerHTML = dialog.inviteList(dialog.withCodes(storage, id, listed, now, since), address('/'), now);
}
// Invitations outside a room you lead: the rooms you lead to choose from (the only one
// opens at once), or who can invite instead of a dead end.
async function invitePicker() {
  if (state.room) {
    const leader = state.members.find(m => m.role === 'owner')?.displayName;
    return modal(
      t('Invite friends'),
      `<p>${esc(leader ? t('Only the leader of {room}, {name}, can invite to it. Ask them for an invite link.', { room: state.room.name, name: leader }) : t('Only the room’s leader can invite to it. Ask them for an invite link.'))}</p><button class="button secondary" data-action="close-dialog">${t('Got it')}</button>`,
    );
  }
  const listed = (await pb.send('/api/odyle/rooms')).rooms || [],
    led = listed.filter(r => r.role === 'owner' || r.role === 'officer');
  if (led.length === 1) return openInvites(led[0].id);
  if (!led.length)
    return modal(
      t('Invite friends'),
      `<p>${listed.length ? t('Only a room’s leader can invite to it. Ask the leader of your room for an invite link, or create a room of your own.') : t('Create a room first, then invite your friends to it.')}</p><button class="button primary" data-action="library">${t('My rooms & characters')} ${icon('arrow')}</button>`,
    );
  modal(
    t('Invite to which room?'),
    `<p>${t('Choose a room you lead. Friends you invite join only that room.')}</p><div class="room-list room-picker">${led.map(r => `<button class="room-item" data-invite-room="${esc(r.id)}"><span class="setup-icon">${icon('diamond')}</span><span><strong>${esc(r.name)}</strong><small>${esc(roleName(r.role))}</small></span>${icon('arrow')}</button>`).join('')}</div>`,
  );
}
async function openInvites(id) {
  closeModal();
  await go('/room/' + id);
  if (state.room?.id === id) await inviteDialog();
}

onData({
  // A link already sent stops working when revoked, so revoking asks first; Keep it goes back to the links.
  revokeInvite: el =>
    ask(
      t('Revoke this invite link?'),
      t(
        'It stops working at once, also for anyone you already sent it to. Members who joined with it stay in the room.',
      ),
      t('Revoke link'),
      { 'confirm-revoke-invite': el.dataset.revokeInvite },
      'invite',
    ),
  confirmRevokeInvite: async el => {
    const id = el.dataset.confirmRevokeInvite,
      result = await send('invite-revoke', { roomId: state.room.id, inviteId: id });
    forgetInvite(storage, state.room.id, id);
    await inviteDialog(result.invites);
    return toast(t('Invite link revoked.'));
  },
  inviteRoom: el => openInvites(el.dataset.inviteRoom),
});
onAction({ invite: () => inviteDialog() });
onSubmit({
  'invite-form': async (form, data) => {
    const result = await send('invite-create', {
      roomId: state.room.id,
      role: data.role,
      expiresIn: Number(data.expiresIn),
      maxUses: Number(data.maxUses),
      label: data.label,
    });
    rememberInvite(storage, state.room.id, result.invite, Date.now() + state.serverOffset);
    form.elements.label.value = '';
    drawInvites(state.room.id, result.invites);
    document.querySelector(`#modal [data-invite="${CSS.escape(result.invite.id)}"] .invite-link`)?.focus();
    toast(t('Invite link made. Copy it and send it to your friend.'));
  },
});
