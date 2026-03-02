import { useSearchParams } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import type { FriendProfile, SelfProfile } from "../types";
import { formatTime } from "../utils";
import "./ButtonStyles.css";
import "./FriendProfileCardsScreen.css";

type FriendProfileCardsScreenProps = {
	api: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
	onUnfriend: (friendId: number) => Promise<void>;
	onBlock: (friendId: number) => Promise<void>;
	onReport: (
		friendId: number,
		reason: string,
		details?: string,
	) => Promise<void>;
	onNicknameUpdated: (friendId: number, nickname: string | null) => void;
};

const reportReasons = [
	"Harassment",
	"Spam",
	"Impersonation",
	"Inappropriate Content",
	"Other",
] as const;

export function FriendProfileCardsScreen(props: FriendProfileCardsScreenProps) {
	const [searchParams] = useSearchParams();
	const [selfProfile, setSelfProfile] = createSignal<SelfProfile | null>(null);
	const [profiles, setProfiles] = createSignal<FriendProfile[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [activeReportFriendId, setActiveReportFriendId] = createSignal<
		number | null
	>(null);
	const [reportReason, setReportReason] = createSignal<string>(
		reportReasons[0],
	);
	const [reportDetails, setReportDetails] = createSignal("");
	const [actionLoadingFriendId, setActionLoadingFriendId] = createSignal<
		number | null
	>(null);
	const [reportSubmitting, setReportSubmitting] = createSignal(false);
	const [confirmingAction, setConfirmingAction] = createSignal(false);
	const [statusMessage, setStatusMessage] = createSignal<string | null>(null);
	const [nicknameSavingFriendId, setNicknameSavingFriendId] = createSignal<
		number | null
	>(null);
	const [nicknameDrafts, setNicknameDrafts] = createSignal<
		Record<number, string>
	>({});
	const [pendingConfirmation, setPendingConfirmation] = createSignal<{
		action: "unfriend" | "block" | "report";
		profile: FriendProfile;
	} | null>(null);
	const [hasScrolledToFocusedCard, setHasScrolledToFocusedCard] =
		createSignal(false);
	const [focusedCardEl, setFocusedCardEl] = createSignal<HTMLElement | null>(
		null,
	);
	let scrollContainerRef: HTMLDivElement | undefined;
	const focusedFriendId = createMemo(() => {
		const value = Number(searchParams.focus);
		return Number.isInteger(value) ? value : null;
	});

	const loadProfiles = async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await props.api<{
				self: SelfProfile | null;
				profiles: FriendProfile[];
			}>("/api/friends/profiles");
			setSelfProfile(response.self);
			setProfiles(response.profiles);
			setNicknameDrafts(
				Object.fromEntries(
					response.profiles.map((profile) => [
						profile.id,
						profile.nickname ?? "",
					]),
				),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setProfiles([]);
			setNicknameDrafts({});
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		void loadProfiles();
	});

	createEffect(() => {
		if (loading() || hasScrolledToFocusedCard()) {
			return;
		}
		const focusId = focusedFriendId();
		if (focusId === null) {
			setHasScrolledToFocusedCard(true);
			return;
		}
		const scrollContainer = scrollContainerRef;
		const targetCard = focusedCardEl();
		if (!scrollContainer || !targetCard) {
			return;
		}
		requestAnimationFrame(() => {
			const headerElement = document.querySelector<HTMLElement>(
				".friend-cards-sticky-header",
			);
			const stickyTop = headerElement
				? Number.parseFloat(getComputedStyle(headerElement).top) || 0
				: 0;
			const headerOffset = (headerElement?.offsetHeight ?? 0) + stickyTop + 4;
			const containerCanScroll =
				scrollContainer.scrollHeight > scrollContainer.clientHeight + 1;
			if (containerCanScroll) {
				scrollContainer.scrollTo({
					top: Math.max(0, targetCard.offsetTop - 4),
					behavior: "smooth",
				});
				setHasScrolledToFocusedCard(true);
				return;
			}

			const cardTopInDocument =
				targetCard.getBoundingClientRect().top + window.scrollY;
			window.scrollTo({
				top: Math.max(0, cardTopInDocument - headerOffset),
				behavior: "smooth",
			});
			setHasScrolledToFocusedCard(true);
		});
	});

	const openConfirmation = (
		action: "unfriend" | "block" | "report",
		profile: FriendProfile,
	) => {
		setStatusMessage(null);
		setPendingConfirmation({ action, profile });
	};

	const handleConfirmAction = async () => {
		const pending = pendingConfirmation();
		if (!pending) {
			return;
		}

		setConfirmingAction(true);
		try {
			if (pending.action === "unfriend") {
				setActionLoadingFriendId(pending.profile.id);
				await props.onUnfriend(pending.profile.id);
				setProfiles((prev) =>
					prev.filter((item) => item.id !== pending.profile.id),
				);
				setStatusMessage(`${pending.profile.username} has been unfriended.`);
			}
			if (pending.action === "block") {
				setActionLoadingFriendId(pending.profile.id);
				await props.onBlock(pending.profile.id);
				setProfiles((prev) =>
					prev.filter((item) => item.id !== pending.profile.id),
				);
				setStatusMessage(`${pending.profile.username} has been blocked.`);
			}
			if (pending.action === "report") {
				setReportSubmitting(true);
				await props.onReport(
					pending.profile.id,
					reportReason(),
					reportDetails(),
				);
				setActiveReportFriendId(null);
				setReportReason(reportReasons[0]);
				setReportDetails("");
				setStatusMessage("Report submitted.");
			}
			setPendingConfirmation(null);
		} catch (err) {
			setStatusMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setActionLoadingFriendId(null);
			setReportSubmitting(false);
			setConfirmingAction(false);
		}
	};

	const updateNicknameDraft = (friendId: number, value: string) => {
		setNicknameDrafts((prev) => ({
			...prev,
			[friendId]: value,
		}));
	};

	const saveNickname = async (profile: FriendProfile) => {
		if (nicknameSavingFriendId() === profile.id) {
			return;
		}
		const draft = (nicknameDrafts()[profile.id] ?? "").trim();
		const current = profile.nickname ?? "";
		if (draft === current) {
			return;
		}
		setStatusMessage(null);
		setNicknameSavingFriendId(profile.id);
		try {
			const response = await props.api<{ nickname: string | null }>(
				`/api/friends/${profile.id}/nickname`,
				{
					method: "PATCH",
					body: JSON.stringify({ nickname: draft }),
				},
			);
			setProfiles((prev) =>
				prev.map((item) =>
					item.id === profile.id
						? {
								...item,
								nickname: response.nickname,
							}
						: item,
				),
			);
			setNicknameDrafts((prev) => ({
				...prev,
				[profile.id]: response.nickname ?? "",
			}));
			props.onNicknameUpdated(profile.id, response.nickname);
			setStatusMessage("Nickname updated.");
		} catch (err) {
			setStatusMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setNicknameSavingFriendId(null);
		}
	};

	createEffect(() => {
		if (!loading() && profiles().length === 0) {
			setActiveReportFriendId(null);
		}
	});

	return (
		<div class="friend-cards-screen stack">
			<Show when={statusMessage()}>
				{(message) => <p class="friend-cards-status">{message()}</p>}
			</Show>
			<Show when={loading()}>
				<p class="friend-cards-status">Loading friend cards...</p>
			</Show>
			<Show when={error()}>
				{(message) => <p class="friend-cards-status">{message()}</p>}
			</Show>

			<Show when={!loading() && profiles().length === 0}>
				<p class="friend-cards-status">No friends to show.</p>
			</Show>

			<div class="friend-cards-scroll" ref={scrollContainerRef}>
				<Show when={selfProfile()}>
					{(self) => (
						<section class="friend-profile-card">
							<div class="friend-profile-card-inner">
								<div class="friend-profile-identity">
									<div class="friend-profile-top-row">
										<div>
											<h2>{self().username}</h2>
										</div>
									</div>
								</div>

								<ul class="friend-profile-metrics">
									<li class="friend-metric">
										<span>Friend Count</span>
										<strong>{self().friendCount}</strong>
									</li>
									<li class="friend-metric">
										<span>Lifetime Oys Sent</span>
										<strong>{self().lifetimeOysSent}</strong>
									</li>
									<li class="friend-metric">
										<span>Lifetime Oys Received</span>
										<strong>{self().lifetimeOysReceived}</strong>
									</li>
								</ul>
							</div>
						</section>
					)}
				</Show>
				<For each={profiles()}>
					{(profile) => (
						<section
							class="friend-profile-card"
							data-friend-id={profile.id}
							ref={(el) => {
								if (profile.id === focusedFriendId()) {
									setFocusedCardEl(el);
								}
							}}
						>
							<div class="friend-profile-card-inner">
								<div class="friend-profile-identity">
									<div class="friend-profile-top-row">
										<div>
											<h2>{profile.username}</h2>
											<div class="friend-profile-nickname-row">
												<input
													class="friend-profile-nickname-input"
													type="text"
													maxLength={40}
													value={nicknameDrafts()[profile.id] ?? ""}
													placeholder="Add nickname"
													aria-label={`Nickname for ${profile.username}`}
													onInput={(event) =>
														updateNicknameDraft(
															profile.id,
															event.currentTarget.value,
														)
													}
													onKeyDown={(event) => {
														if (event.key === "Enter") {
															event.preventDefault();
															void saveNickname(profile);
														}
													}}
													onBlur={() => void saveNickname(profile)}
												/>
											</div>
										</div>
										<div class="friend-profile-last-oy-wrap">
											<Show when={profile.lastOyCreatedAt !== null}>
												<div class="friend-profile-last-oy">
													<span class="friend-profile-last-oy-direction">
														{profile.lastOyFromUserId === profile.id
															? "↙"
															: "↗"}
													</span>
													<span>
														{formatTime(profile.lastOyCreatedAt as number)}
													</span>
												</div>
											</Show>
											<Show when={profile.lastOyCreatedAt === null}>
												<div class="friend-profile-last-oy">No Oys yet</div>
											</Show>
											<Show when={profile.streak >= 2}>
												<div class="friend-profile-streak">
													🔥 {profile.streak}-day streak
												</div>
											</Show>
										</div>
									</div>
								</div>

								<ul class="friend-profile-metrics">
									<li class="friend-metric">
										<span>Friend Count</span>
										<strong>{profile.friendCount}</strong>
									</li>
									<li class="friend-metric">
										<span>Lifetime Oys Sent</span>
										<strong>{profile.lifetimeOysSent}</strong>
									</li>
									<li class="friend-metric">
										<span>Lifetime Oys Received</span>
										<strong>{profile.lifetimeOysReceived}</strong>
									</li>
								</ul>

								<div class="friend-profile-actions stack">
									<button
										class="btn-secondary"
										type="button"
										onClick={() => openConfirmation("unfriend", profile)}
										disabled={actionLoadingFriendId() === profile.id}
									>
										Unfriend
									</button>
									<button
										class="btn-secondary friend-danger"
										type="button"
										onClick={() => openConfirmation("block", profile)}
										disabled={actionLoadingFriendId() === profile.id}
									>
										Block
									</button>
									<button
										class="btn-text friend-report-trigger"
										type="button"
										onClick={() => {
											setActiveReportFriendId((current) =>
												current === profile.id ? null : profile.id,
											);
										}}
									>
										Report
									</button>
								</div>

								<Show when={activeReportFriendId() === profile.id}>
									<div class="friend-report-panel stack">
										<label
											class="friend-report-label"
											for={`report-reason-${profile.id}`}
										>
											Reason
										</label>
										<select
											id={`report-reason-${profile.id}`}
											class="friend-report-select"
											value={reportReason()}
											onInput={(event) =>
												setReportReason(event.currentTarget.value)
											}
										>
											<For each={reportReasons}>
												{(reason) => <option value={reason}>{reason}</option>}
											</For>
										</select>

										<label
											class="friend-report-label"
											for={`report-details-${profile.id}`}
										>
											Details (optional)
										</label>
										<textarea
											id={`report-details-${profile.id}`}
											class="friend-report-textarea"
											rows={3}
											maxLength={2000}
											placeholder="Add context for your report"
											value={reportDetails()}
											onInput={(event) =>
												setReportDetails(event.currentTarget.value)
											}
										/>

										<button
											class="btn-secondary friend-danger"
											type="button"
											disabled={reportSubmitting()}
											onClick={() => openConfirmation("report", profile)}
										>
											Submit Report
										</button>
									</div>
								</Show>
							</div>
						</section>
					)}
				</For>
			</div>

			<Show when={pendingConfirmation()}>
				{(pending) => {
					const action = pending().action;
					const username = pending().profile.username;
					const title =
						action === "unfriend"
							? `Unfriend ${username}?`
							: action === "block"
								? `Block ${username}?`
								: `Report ${username}?`;
					const description =
						action === "unfriend"
							? "This removes both of you from each other's friends lists."
							: action === "block"
								? "This blocks the user and removes them from your friends list."
								: "Your report will be submitted to admins for review.";
					const confirmLabel =
						action === "unfriend"
							? "Confirm Unfriend"
							: action === "block"
								? "Confirm Block"
								: "Submit Report";
					const confirmClass =
						action === "unfriend"
							? "btn-secondary"
							: "btn-secondary friend-danger";

					return (
						<div class="friend-confirm-overlay" role="presentation">
							<div
								class="friend-confirm-modal card"
								role="dialog"
								aria-modal="true"
								aria-label={title}
							>
								<h3 class="friend-confirm-title">{title}</h3>
								<p class="friend-confirm-description">{description}</p>
								<div class="friend-confirm-actions">
									<button
										class="btn-secondary"
										type="button"
										onClick={() => setPendingConfirmation(null)}
										disabled={confirmingAction()}
									>
										Cancel
									</button>
									<button
										class={confirmClass}
										type="button"
										onClick={() => void handleConfirmAction()}
										disabled={confirmingAction()}
									>
										{confirmingAction() ? "Working..." : confirmLabel}
									</button>
								</div>
							</div>
						</div>
					);
				}}
			</Show>
		</div>
	);
}
