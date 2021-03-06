"use strict";

// vendor libraries
require("jquery-ui/ui/widgets/sortable");
const $ = require("jquery");
const io = require("socket.io-client");
const Mousetrap = require("mousetrap");
const URI = require("urijs");

// our libraries
require("./libs/jquery/inputhistory");
require("./libs/jquery/stickyscroll");
require("./libs/jquery/tabcomplete");
const helpers_parse = require("./libs/handlebars/parse");
const helpers_roundBadgeNumber = require("./libs/handlebars/roundBadgeNumber");
const slideoutMenu = require("./libs/slideout");
const templates = require("../views");

$(function() {
	var path = window.location.pathname + "socket.io/";
	var socket = io({
		path: path,
		autoConnect: false,
		reconnection: false
	});
	var commands = [
		"/away",
		"/back",
		"/close",
		"/connect",
		"/deop",
		"/devoice",
		"/disconnect",
		"/invite",
		"/join",
		"/kick",
		"/leave",
		"/me",
		"/mode",
		"/msg",
		"/nick",
		"/notice",
		"/op",
		"/part",
		"/query",
		"/quit",
		"/raw",
		"/say",
		"/send",
		"/server",
		"/slap",
		"/topic",
		"/voice",
		"/whois"
	];

	var sidebar = $("#sidebar, #footer");
	var chat = $("#chat");

	var ignoreSortSync = false;

	var pop;
	try {
		pop = new Audio();
		pop.src = "audio/pop.ogg";
	} catch (e) {
		pop = {
			play: $.noop
		};
	}

	$("#play").on("click", function() {
		pop.play();
	});

	var favicon = $("#favicon");

	function setLocalStorageItem(key, value) {
		try {
			window.localStorage.setItem(key, value);
		} catch (e) {
			// Do nothing. If we end up here, web storage quota exceeded, or user is
			// in Safari's private browsing where localStorage's setItem is not
			// available. See http://stackoverflow.com/q/14555347/1935861.
		}
	}

	[
		"connect_error",
		"connect_failed",
		"disconnect",
		"error",
	].forEach(function(e) {
		socket.on(e, function(data) {
			$("#loading-page-message").text("Connection failed: " + data);
			$("#connection-error").addClass("shown").one("click", function() {
				window.onbeforeunload = null;
				window.location.reload();
			});

			// Disables sending a message by pressing Enter. `off` is necessary to
			// cancel `inputhistory`, which overrides hitting Enter. `on` is then
			// necessary to avoid creating new lines when hitting Enter without Shift.
			// This is fairly hacky but this solution is not permanent.
			$("#input").off("keydown").on("keydown", function(event) {
				if (event.which === 13 && !event.shiftKey) {
					event.preventDefault();
				}
			});
			// Hides the "Send Message" button
			$("#submit").remove();

			console.error(data);
		});
	});

	socket.on("connecting", function() {
		$("#loading-page-message").text("Connecting…");
	});

	socket.on("connect", function() {
		$("#loading-page-message").text("Finalizing connection…");
	});

	socket.on("authorized", function() {
		$("#loading-page-message").text("Authorized, loading messages…");
	});

	socket.on("auth", function(data) {
		var login = $("#sign-in");
		var token;

		login.find(".btn").prop("disabled", false);

		if (!data.success) {
			window.localStorage.removeItem("token");

			var error = login.find(".error");
			error.show().closest("form").one("submit", function() {
				error.hide();
			});
		} else {
			token = window.localStorage.getItem("token");
			if (token) {
				$("#loading-page-message").text("Authorizing…");
				socket.emit("auth", {token: token});
			}
		}

		var input = login.find("input[name='user']");
		if (input.val() === "") {
			input.val(window.localStorage.getItem("user") || "");
		}
		if (token) {
			return;
		}
		sidebar.find(".sign-in")
			.click()
			.end()
			.find(".networks")
			.html("")
			.next()
			.show();
	});

	socket.on("change-password", function(data) {
		var passwordForm = $("#change-password");
		if (data.error || data.success) {
			var message = data.success ? data.success : data.error;
			var feedback = passwordForm.find(".feedback");

			if (data.success) {
				feedback.addClass("success").removeClass("error");
			} else {
				feedback.addClass("error").removeClass("success");
			}

			feedback.text(message).show();
			feedback.closest("form").one("submit", function() {
				feedback.hide();
			});
		}

		if (data.token && window.localStorage.getItem("token") !== null) {
			setLocalStorageItem("token", data.token);
		}

		passwordForm
			.find("input")
			.val("")
			.end()
			.find(".btn")
			.prop("disabled", false);
	});

	socket.on("init", function(data) {
		$("#loading-page-message").text("Rendering…");

		if (data.networks.length === 0) {
			$("#footer").find(".connect").trigger("click");
		} else {
			renderNetworks(data);
		}

		if (data.token && $("#sign-in-remember").is(":checked")) {
			setLocalStorageItem("token", data.token);
		} else {
			window.localStorage.removeItem("token");
		}

		$("body").removeClass("signed-out");
		$("#loading").remove();
		$("#sign-in").remove();

		var id = data.active;
		var target = sidebar.find("[data-id='" + id + "']").trigger("click");
		if (target.length === 0) {
			var first = sidebar.find(".chan")
				.eq(0)
				.trigger("click");
			if (first.length === 0) {
				$("#footer").find(".connect").trigger("click");
			}
		}
	});

	socket.on("open", function(id) {
		// Another client opened the channel, clear the unread counter
		sidebar.find(".chan[data-id='" + id + "'] .badge")
			.removeClass("highlight")
			.empty();
	});

	socket.on("join", function(data) {
		var id = data.network;
		var network = sidebar.find("#network-" + id);
		network.append(
			templates.chan({
				channels: [data.chan]
			})
		);
		chat.append(
			templates.chat({
				channels: [data.chan]
			})
		);
		renderChannel(data.chan);

		// Queries do not automatically focus, unless the user did a whois
		if (data.chan.type === "query" && !data.shouldOpen) {
			return;
		}

		sidebar.find(".chan")
			.sort(function(a, b) {
				return $(a).data("id") - $(b).data("id");
			})
			.last()
			.click();
	});

	function buildChatMessage(data) {
		var type = data.msg.type;
		var target = "#chan-" + data.chan;
		if (type === "error") {
			target = "#chan-" + chat.find(".active").data("id");
		}

		var chan = chat.find(target);
		var template = "msg";

		if (!data.msg.highlight && !data.msg.self && (type === "message" || type === "notice") && highlights.some(function(h) {
			return data.msg.text.toLocaleLowerCase().indexOf(h.toLocaleLowerCase()) > -1;
		})) {
			data.msg.highlight = true;
		}

		if ([
			"invite",
			"join",
			"mode",
			"kick",
			"nick",
			"part",
			"quit",
			"topic",
			"topic_set_by",
			"action",
			"whois",
			"ctcp",
			"channel_list",
		].indexOf(type) !== -1) {
			template = "msg_action";
		} else if (type === "unhandled") {
			template = "msg_unhandled";
		}

		var msg = $(templates[template](data.msg));
		var text = msg.find(".text");

		if (template === "msg_action") {
			text.html(templates.actions[type](data.msg));
		}

		if ((type === "message" || type === "action") && chan.hasClass("channel")) {
			var nicks = chan.find(".users").data("nicks");
			if (nicks) {
				var find = nicks.indexOf(data.msg.from);
				if (find !== -1 && typeof move === "function") {
					move(nicks, find, 0);
				}
			}
		}

		return msg;
	}

	function buildChannelMessages(channel, messages) {
		return messages.reduce(function(docFragment, message) {
			docFragment.append(buildChatMessage({
				chan: channel,
				msg: message
			}));
			return docFragment;
		}, $(document.createDocumentFragment()));
	}

	function renderChannel(data) {
		renderChannelMessages(data);
		renderChannelUsers(data);
	}

	function renderChannelMessages(data) {
		var documentFragment = buildChannelMessages(data.id, data.messages);
		var channel = chat.find("#chan-" + data.id + " .messages").append(documentFragment);

		if (data.firstUnread > 0) {
			var first = channel.find("#msg-" + data.firstUnread);

			// TODO: If the message is far off in the history, we still need to append the marker into DOM
			if (!first.length) {
				channel.prepend(templates.unread_marker());
			} else {
				first.before(templates.unread_marker());
			}
		} else {
			channel.append(templates.unread_marker());
		}

		if (data.type !== "lobby") {
			var lastDate;
			$(chat.find("#chan-" + data.id + " .messages .msg[data-time]")).each(function() {
				var msg = $(this);
				var msgDate = new Date(msg.attr("data-time"));

				// Top-most message in a channel
				if (!lastDate) {
					lastDate = msgDate;
					msg.before(templates.date_marker({msgDate: msgDate}));
				}

				if (lastDate.toDateString() !== msgDate.toDateString()) {
					msg.before(templates.date_marker({msgDate: msgDate}));
				}

				lastDate = msgDate;
			});
		}
	}

	function renderChannelUsers(data) {
		var users = chat.find("#chan-" + data.id).find(".users");
		var nicks = users.data("nicks") || [];
		var i, oldSortOrder = {};

		for (i in nicks) {
			oldSortOrder[nicks[i]] = i;
		}

		nicks = [];

		for (i in data.users) {
			nicks.push(data.users[i].name);
		}

		nicks = nicks.sort(function(a, b) {
			return (oldSortOrder[a] || Number.MAX_VALUE) - (oldSortOrder[b] || Number.MAX_VALUE);
		});

		users.html(templates.user(data)).data("nicks", nicks);
	}

	function renderNetworks(data) {
		sidebar.find(".empty").hide();
		sidebar.find(".networks").append(
			templates.network({
				networks: data.networks
			})
		);

		var channels = $.map(data.networks, function(n) {
			return n.channels;
		});
		chat.append(
			templates.chat({
				channels: channels
			})
		);
		channels.forEach(renderChannel);

		confirmExit();
		sortable();

		if (sidebar.find(".highlight").length) {
			toggleNotificationMarkers(true);
		}
	}

	socket.on("msg", function(data) {
		var msg = buildChatMessage(data);
		var target = "#chan-" + data.chan;
		var container = chat.find(target + " .messages");

        // Check if date changed
		var prevMsg = $(container.find(".msg")).last();
		var prevMsgTime = new Date(prevMsg.attr("data-time"));
		var msgTime = new Date(msg.attr("data-time"));

		// It's the first message in a channel/query
		if (prevMsg.length === 0) {
			container.append(templates.date_marker({msgDate: msgTime}));
		}

		if (prevMsgTime.toDateString() !== msgTime.toDateString()) {
			prevMsg.after(templates.date_marker({msgDate: msgTime}));
		}

        // Add message to the container
		container
			.append(msg)
			.trigger("msg", [
				target,
				data
			]);

		if (data.msg.self) {
			container
				.find(".unread-marker")
				.appendTo(container);
		}
	});

	socket.on("more", function(data) {
		var documentFragment = buildChannelMessages(data.chan, data.messages);
		var chan = chat
			.find("#chan-" + data.chan)
			.find(".messages");

		// Remove the date-change marker we put at the top, because it may
		// not actually be a date change now
		var children = $(chan).children();
		if (children.eq(0).hasClass("date-marker")) { // Check top most child
			children.eq(0).remove();
		} else if (children.eq(0).hasClass("unread-marker") && children.eq(1).hasClass("date-marker")) {
			// Otherwise the date-marker would get 'stuck' because of the new-message marker
			children.eq(1).remove();
		}

		// get the scrollable wrapper around messages
		var scrollable = chan.closest(".chat");
		var heightOld = chan.height();
		chan.prepend(documentFragment).end();

		// restore scroll position
		var position = chan.height() - heightOld;
		scrollable.scrollTop(position);

		if (data.messages.length !== 100) {
			scrollable.find(".show-more").removeClass("show");
		}

		// Date change detect
		// Have to use data instaid of the documentFragment because it's being weird
		var lastDate;
		$(data.messages).each(function() {
			var msgData = this;
			var msgDate = new Date(msgData.time);
			var msg = $(chat.find("#chan-" + data.chan + " .messages #msg-" + msgData.id));

			// Top-most message in a channel
			if (!lastDate) {
				lastDate = msgDate;
				msg.before(templates.date_marker({msgDate: msgDate}));
			}

			if (lastDate.toDateString() !== msgDate.toDateString()) {
				msg.before(templates.date_marker({msgDate: msgDate}));
			}

			lastDate = msgDate;
		});
	});

	socket.on("network", function(data) {
		renderNetworks(data);

		sidebar.find(".chan")
			.last()
			.trigger("click");

		$("#connect")
			.find(".btn")
			.prop("disabled", false)
			.end();
	});

	socket.on("network_changed", function(data) {
		sidebar.find("#network-" + data.network).data("options", data.serverOptions);
	});

	socket.on("nick", function(data) {
		var id = data.network;
		var nick = data.nick;
		var network = sidebar.find("#network-" + id).data("nick", nick);
		if (network.find(".active").length) {
			setNick(nick);
		}
	});

	socket.on("part", function(data) {
		var chanMenuItem = sidebar.find(".chan[data-id='" + data.chan + "']");

		// When parting from the active channel/query, jump to the network's lobby
		if (chanMenuItem.hasClass("active")) {
			chanMenuItem.parent(".network").find(".lobby").click();
		}

		chanMenuItem.remove();
		$("#chan-" + data.chan).remove();
	});

	socket.on("quit", function(data) {
		var id = data.network;
		sidebar.find("#network-" + id)
			.remove()
			.end();
		var chan = sidebar.find(".chan")
			.eq(0)
			.trigger("click");
		if (chan.length === 0) {
			sidebar.find(".empty").show();
		}
	});

	socket.on("toggle", function(data) {
		var toggle = $("#toggle-" + data.id);
		toggle.parent().after(templates.toggle({toggle: data}));
		switch (data.type) {
		case "link":
			if (options.links) {
				toggle.click();
			}
			break;

		case "image":
			if (options.thumbnails) {
				toggle.click();
			}
			break;
		}
	});

	socket.on("topic", function(data) {
		var topic = $("#chan-" + data.chan).find(".header .topic");
		topic.html(helpers_parse(data.topic));
		// .attr() is safe escape-wise but consider the capabilities of the attribute
		topic.attr("title", data.topic);
	});

	socket.on("users", function(data) {
		var chan = chat.find("#chan-" + data.chan);

		if (chan.hasClass("active")) {
			socket.emit("names", {
				target: data.chan
			});
		} else {
			chan.data("needsNamesRefresh", true);
		}
	});

	socket.on("names", renderChannelUsers);

	var userStyles = $("#user-specified-css");
	var highlights = [];
	var options = $.extend({
		coloredNicks: true,
		desktopNotifications: false,
		join: true,
		links: true,
		mode: true,
		motd: false,
		nick: true,
		notification: true,
		notifyAllMessages: false,
		part: true,
		quit: true,
		theme: $("#theme").attr("href").replace(/^themes\/(.*).css$/, "$1"), // Extracts default theme name, set on the server configuration
		thumbnails: true,
		userStyles: userStyles.text(),
	}, JSON.parse(window.localStorage.getItem("settings")));

	var windows = $("#windows");

	(function SettingsScope() {
		var settings = $("#settings");

		for (var i in options) {
			if (i === "userStyles") {
				if (!/[?&]nocss/.test(window.location.search)) {
					$(document.head).find("#user-specified-css").html(options[i]);
				}
				settings.find("#user-specified-css-input").val(options[i]);
			} else if (i === "highlights") {
				settings.find("input[name=" + i + "]").val(options[i]);
			} else if (i === "theme") {
				$("#theme").attr("href", "themes/" + options[i] + ".css");
				settings.find("select[name=" + i + "]").val(options[i]);
			} else if (options[i]) {
				settings.find("input[name=" + i + "]").prop("checked", true);
			}
		}

		settings.on("change", "input, select, textarea", function() {
			var self = $(this);
			var name = self.attr("name");

			if (self.attr("type") === "checkbox") {
				options[name] = self.prop("checked");
			} else {
				options[name] = self.val();
			}

			setLocalStorageItem("settings", JSON.stringify(options));

			if ([
				"join",
				"mode",
				"motd",
				"nick",
				"part",
				"quit",
				"notifyAllMessages",
			].indexOf(name) !== -1) {
				chat.toggleClass("hide-" + name, !self.prop("checked"));
			} else if (name === "coloredNicks") {
				chat.toggleClass("colored-nicks", self.prop("checked"));
			} else if (name === "theme") {
				$("#theme").attr("href", "themes/" + options[name] + ".css");
			} else if (name === "userStyles") {
				userStyles.html(options[name]);
			} else if (name === "highlights") {
				var highlightString = options[name];
				highlights = highlightString.split(",").map(function(h) {
					return h.trim();
				}).filter(function(h) {
					// Ensure we don't have empty string in the list of highlights
					// otherwise, users get notifications for everything
					return h !== "";
				});
			}
		}).find("input")
			.trigger("change");

		$("#desktopNotifications").on("change", function() {
			if ($(this).prop("checked") && Notification.permission !== "granted") {
				Notification.requestPermission(updateDesktopNotificationStatus);
			}
		});

		// Updates the checkbox and warning in settings when the Settings page is
		// opened or when the checkbox state is changed.
		// When notifications are not supported, this is never called (because
		// checkbox state can not be changed).
		var updateDesktopNotificationStatus = function() {
			if (Notification.permission === "denied") {
				desktopNotificationsCheckbox.attr("disabled", true);
				desktopNotificationsCheckbox.attr("checked", false);
				warningBlocked.show();
			} else {
				if (Notification.permission === "default" && desktopNotificationsCheckbox.prop("checked")) {
					desktopNotificationsCheckbox.attr("checked", false);
				}
				desktopNotificationsCheckbox.attr("disabled", false);
				warningBlocked.hide();
			}
		};

		// If browser does not support notifications, override existing settings and
		// display proper message in settings.
		var desktopNotificationsCheckbox = $("#desktopNotifications");
		var warningUnsupported = $("#warnUnsupportedDesktopNotifications");
		var warningBlocked = $("#warnBlockedDesktopNotifications");
		warningBlocked.hide();
		if (("Notification" in window)) {
			warningUnsupported.hide();
			windows.on("show", "#settings", updateDesktopNotificationStatus);
		} else {
			options.desktopNotifications = false;
			desktopNotificationsCheckbox.attr("disabled", true);
			desktopNotificationsCheckbox.attr("checked", false);
		}
	}());

	var viewport = $("#viewport");
	var sidebarSlide = slideoutMenu(viewport[0], sidebar[0]);
	var contextMenuContainer = $("#context-menu-container");
	var contextMenu = $("#context-menu");

	$("#main").on("click", function(e) {
		if ($(e.target).is(".lt")) {
			sidebarSlide.toggle(!sidebarSlide.isOpen());
		} else if (sidebarSlide.isOpen()) {
			sidebarSlide.toggle(false);
		}
	});

	viewport.on("click", ".rt", function(e) {
		var self = $(this);
		viewport.toggleClass(self.attr("class"));
		e.stopPropagation();
	});

	function positionContextMenu(that, e) {
		var offset;
		var menuWidth = contextMenu.outerWidth();
		var menuHeight = contextMenu.outerHeight();

		if (that.hasClass("menu")) {
			offset = that.offset();
			offset.left -= menuWidth - that.outerWidth();
			offset.top += that.outerHeight();
			return offset;
		}

		offset = {left: e.pageX, top: e.pageY};

		if ((window.innerWidth - offset.left) < menuWidth) {
			offset.left = window.innerWidth - menuWidth;
		}

		if ((window.innerHeight - offset.top) < menuHeight) {
			offset.top = window.innerHeight - menuHeight;
		}

		return offset;
	}

	function showContextMenu(that, e) {
		var target = $(e.currentTarget);
		var output = "";

		if (target.hasClass("user")) {
			output = templates.contextmenu_item({
				class: "user",
				text: target.text(),
				data: target.data("name")
			});
		} else if (target.hasClass("chan")) {
			output = templates.contextmenu_item({
				class: "chan",
				text: target.data("title"),
				data: target.data("target")
			});
			output += templates.contextmenu_divider();
			output += templates.contextmenu_item({
				class: "close",
				text: target.hasClass("lobby") ? "Disconnect" : target.hasClass("channel") ? "Leave" : "Close",
				data: target.data("target")
			});
		}

		contextMenuContainer.show();
		contextMenu
			.html(output)
			.css(positionContextMenu($(that), e));

		return false;
	}

	viewport.on("contextmenu", ".user, .network .chan", function(e) {
		return showContextMenu(this, e);
	});

	viewport.on("click", "#chat .menu", function(e) {
		e.currentTarget = $(e.currentTarget).closest(".chan")[0];
		return showContextMenu(this, e);
	});

	contextMenuContainer.on("click contextmenu", function() {
		contextMenuContainer.hide();
		return false;
	});

	function resetInputHeight(input) {
		input.style.height = input.style.minHeight;
	}

	var input = $("#input")
		.history()
		.on("input keyup", function() {
			var style = window.getComputedStyle(this);

			// Start by resetting height before computing as scrollHeight does not
			// decrease when deleting characters
			resetInputHeight(this);

			this.style.height = Math.min(
				Math.round(window.innerHeight - 100), // prevent overflow
				this.scrollHeight
				+ Math.round(parseFloat(style.borderTopWidth) || 0)
				+ Math.round(parseFloat(style.borderBottomWidth) || 0)
			) + "px";

			$("#chat .chan.active .chat").trigger("msg.sticky"); // fix growing
		})
		.tab(complete, {hint: false});

	var focus = $.noop;
	if (!("ontouchstart" in window || navigator.maxTouchPoints > 0)) {
		focus = function() {
			if (chat.find(".active").hasClass("chan")) {
				input.focus();
			}
		};

		$(window).on("focus", focus);

		chat.on("click", ".chat", function() {
			setTimeout(function() {
				var text = "";
				if (window.getSelection) {
					text = window.getSelection().toString();
				} else if (document.selection && document.selection.type !== "Control") {
					text = document.selection.createRange().text;
				}
				if (!text) {
					focus();
				}
			}, 2);
		});
	}

	// Triggering click event opens the virtual keyboard on mobile
	// This can only be called from another interactive event (e.g. button click)
	var forceFocus = function() {
		input.trigger("click").focus();
	};

	// Cycle through nicks for the current word, just like hitting "Tab"
	$("#cycle-nicks").on("click", function() {
		input.triggerHandler($.Event("keydown.tabcomplete", {which: 9}));
		forceFocus();
	});

	$("#form").on("submit", function(e) {
		e.preventDefault();
		forceFocus();
		var text = input.val();

		if (text.length === 0) {
			return;
		}

		input.val("");
		resetInputHeight(input.get(0));

		if (text.indexOf("/clear") === 0) {
			clear();
			return;
		}

		socket.emit("input", {
			target: chat.data("id"),
			text: text
		});
	});

	function findCurrentNetworkChan(name) {
		name = name.toLowerCase();

		return $(".network .chan.active")
			.parent(".network")
			.find(".chan")
			.filter(function() {
				return $(this).data("title").toLowerCase() === name;
			})
			.first();
	}

	$("button#set-nick").on("click", function() {
		toggleNickEditor(true);

		// Selects existing nick in the editable text field
		var element = document.querySelector("#nick-value");
		element.focus();
		var range = document.createRange();
		range.selectNodeContents(element);
		var selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});

	$("button#cancel-nick").on("click", cancelNick);
	$("button#submit-nick").on("click", submitNick);

	function toggleNickEditor(toggle) {
		$("#nick").toggleClass("editable", toggle);
		$("#nick-value").attr("contenteditable", toggle);
	}

	function submitNick() {
		var newNick = $("#nick-value").text().trim();

		if (newNick.length === 0) {
			cancelNick();
			return;
		}

		toggleNickEditor(false);

		socket.emit("input", {
			target: chat.data("id"),
			text: "/nick " + newNick
		});
	}

	function cancelNick() {
		setNick(sidebar.find(".chan.active").closest(".network").data("nick"));
	}

	$("#nick-value").keypress(function(e) {
		switch (e.keyCode ? e.keyCode : e.which) {
		case 13: // Enter
			// Ensures a new line is not added when pressing Enter
			e.preventDefault();
			break;
		}
	}).keyup(function(e) {
		switch (e.keyCode ? e.keyCode : e.which) {
		case 13: // Enter
			submitNick();
			break;
		case 27: // Escape
			cancelNick();
			break;
		}
	});

	chat.on("click", ".inline-channel", function() {
		var name = $(this).data("chan");
		var chan = findCurrentNetworkChan(name);

		if (chan.length) {
			chan.click();
		} else {
			socket.emit("input", {
				target: chat.data("id"),
				text: "/join " + name
			});
		}
	});

	chat.on("click", ".user", function() {
		var name = $(this).data("name");
		var chan = findCurrentNetworkChan(name);

		if (chan.length) {
			chan.click();
		}

		socket.emit("input", {
			target: chat.data("id"),
			text: "/whois " + name
		});
	});

	sidebar.on("click", ".chan, button", function() {
		var self = $(this);
		var target = self.data("target");
		if (!target) {
			return;
		}

		chat.data(
			"id",
			self.data("id")
		);
		socket.emit(
			"open",
			self.data("id")
		);

		sidebar.find(".active").removeClass("active");
		self.addClass("active")
			.find(".badge")
			.removeClass("highlight")
			.empty();

		if (sidebar.find(".highlight").length === 0) {
			toggleNotificationMarkers(false);
		}

		sidebarSlide.toggle(false);

		var lastActive = $("#windows > .active");

		lastActive
			.removeClass("active")
			.find(".chat")
			.unsticky();

		var lastActiveChan = lastActive
			.find(".chan.active")
			.removeClass("active");

		lastActiveChan
			.find(".unread-marker")
			.appendTo(lastActiveChan.find(".messages"));

		var chan = $(target)
			.addClass("active")
			.trigger("show");

		var title = "The Lounge";
		if (chan.data("title")) {
			title = chan.data("title") + " — " + title;
		}
		document.title = title;

		var placeholder = "";
		if (chan.data("type") === "channel" || chan.data("type") === "query") {
			placeholder = `Write to ${chan.data("title")}`;
		}
		input.attr("placeholder", placeholder);

		if (self.hasClass("chan")) {
			$("#chat-container").addClass("active");
			setNick(self.closest(".network").data("nick"));
		}

		var chanChat = chan.find(".chat");
		if (chanChat.length > 0) {
			chanChat.sticky();
		}

		if (chan.data("needsNamesRefresh") === true) {
			chan.data("needsNamesRefresh", false);
			socket.emit("names", {target: self.data("id")});
		}

		focus();
	});

	sidebar.on("click", "#sign-out", function() {
		window.localStorage.removeItem("token");
		location.reload();
	});

	sidebar.on("click", ".close", function() {
		var cmd = "/close";
		var chan = $(this).closest(".chan");
		if (chan.hasClass("lobby")) {
			cmd = "/quit";
			var server = chan.find(".name").html();
			if (!confirm("Disconnect from " + server + "?")) {
				return false;
			}
		}
		socket.emit("input", {
			target: chan.data("id"),
			text: cmd
		});
		chan.css({
			transition: "none",
			opacity: 0.4
		});
		return false;
	});

	contextMenu.on("click", ".context-menu-item", function() {
		switch ($(this).data("action")) {
		case "close":
			$(".networks .chan[data-target='" + $(this).data("data") + "'] .close").click();
			break;
		case "chan":
			$(".networks .chan[data-target='" + $(this).data("data") + "']").click();
			break;
		case "user":
			$(".channel.active .users .user[data-name='" + $(this).data("data") + "']").click();
			break;
		}
	});

	chat.on("input", ".search", function() {
		var value = $(this).val().toLowerCase();
		var names = $(this).closest(".users").find(".names");
		names.find(".user").each(function() {
			var btn = $(this);
			var name = btn.text().toLowerCase().replace(/[+%@~]/, "");
			if (name.indexOf(value) > -1) {
				btn.show();
			} else {
				btn.hide();
			}
		});
	});

	chat.on("msg", ".messages", function(e, target, msg) {
		var unread = msg.unread;
		msg = msg.msg;

		if (msg.self) {
			return;
		}

		var button = sidebar.find(".chan[data-target='" + target + "']");
		if (msg.highlight || (options.notifyAllMessages && msg.type === "message")) {
			if (!document.hasFocus() || !$(target).hasClass("active")) {
				if (options.notification) {
					try {
						pop.play();
					} catch (exception) {
						// On mobile, sounds can not be played without user interaction.
					}
				}
				toggleNotificationMarkers(true);

				if (options.desktopNotifications && Notification.permission === "granted") {
					var title;
					var body;

					if (msg.type === "invite") {
						title = "New channel invite:";
						body = msg.from + " invited you to " + msg.channel;
					} else {
						title = msg.from;
						if (!button.hasClass("query")) {
							title += " (" + button.data("title").trim() + ")";
						}
						if (msg.type === "message") {
							title += " says:";
						}
						body = msg.text.replace(/\x03(?:[0-9]{1,2}(?:,[0-9]{1,2})?)?|[\x00-\x1F]|\x7F/g, "").trim();
					}

					try {
						var notify = new Notification(title, {
							body: body,
							icon: "img/logo-64.png",
							tag: target
						});
						notify.addEventListener("click", function() {
							window.focus();
							button.click();
							this.close();
						});
					} catch (exception) {
						// `new Notification(...)` is not supported and should be silenced.
					}
				}
			}
		}

		if (button.hasClass("active")) {
			return;
		}

		if (!unread) {
			return;
		}

		var badge = button.find(".badge").html(helpers_roundBadgeNumber(unread));

		if (msg.highlight) {
			badge.addClass("highlight");
		}
	});

	chat.on("click", ".show-more-button", function() {
		var self = $(this);
		var count = self.parent().next(".messages").children().length;
		socket.emit("more", {
			target: self.data("id"),
			count: count
		});
	});

	chat.on("click", ".toggle-button", function() {
		var self = $(this);
		var localChat = self.closest(".chat");
		var bottom = localChat.isScrollBottom();
		var content = self.parent().next(".toggle-content");
		if (bottom && !content.hasClass("show")) {
			var img = content.find("img");
			if (img.length !== 0 && !img.width()) {
				img.on("load", function() {
					localChat.scrollBottom();
				});
			}
		}
		content.toggleClass("show");
		if (bottom) {
			localChat.scrollBottom();
		}
	});

	var forms = $("#sign-in, #connect, #change-password");

	windows.on("show", "#sign-in", function() {
		$(this).find("input").each(function() {
			var self = $(this);
			if (self.val() === "") {
				self.focus();
				return false;
			}
		});
	});
	if ($("body").hasClass("public")) {
		$("#connect").one("show", function() {
			var params = URI(document.location.search);
			params = params.search(true);
			// Possible parameters:  name, host, port, password, tls, nick, username, realname, join
			// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in#Iterating_over_own_properties_only
			for (var key in params) {
				if (params.hasOwnProperty(key)) {
					var value = params[key];
					// \W searches for non-word characters
					key = key.replace(/\W/g, "");

					var element = $("#connect input[name='" + key + "']");
					// if the element exists, it isn't disabled, and it isn't hidden
					if (element.length > 0 && !element.is(":disabled") && !element.is(":hidden")) {
						if (element.is(":checkbox")) {
							element.prop("checked", (value === "1" || value === "true") ? true : false);
						} else {
							element.val(value);
						}
					}
				}
			}
		});
	}

	forms.on("submit", "form", function(e) {
		e.preventDefault();
		var event = "auth";
		var form = $(this);
		form.find(".btn")
			.attr("disabled", true)
			.end();
		if (form.closest(".window").attr("id") === "connect") {
			event = "conn";
		} else if (form.closest("div").attr("id") === "change-password") {
			event = "change-password";
		}
		var values = {};
		$.each(form.serializeArray(), function(i, obj) {
			if (obj.value !== "") {
				values[obj.name] = obj.value;
			}
		});
		if (values.user) {
			setLocalStorageItem("user", values.user);
		}
		socket.emit(
			event, values
		);
	});

	forms.on("focusin", ".nick", function() {
		// Need to set the first "lastvalue", so it can be used in the below function
		var nick = $(this);
		nick.data("lastvalue", nick.val());
	});

	forms.on("input", ".nick", function() {
		var nick = $(this).val();
		var usernameInput = forms.find(".username");

		// Because this gets called /after/ it has already changed, we need use the previous value
		var lastValue = $(this).data("lastvalue");

		// They were the same before the change, so update the username field
		if (usernameInput.val() === lastValue) {
			usernameInput.val(nick);
		}

		// Store the "previous" value, for next time
		$(this).data("lastvalue", nick);
	});

	(function HotkeysScope() {
		Mousetrap.bind([
			"command+up",
			"command+down",
			"ctrl+up",
			"ctrl+down"
		], function(e, keys) {
			var channels = sidebar.find(".chan");
			var index = channels.index(channels.filter(".active"));
			var direction = keys.split("+").pop();
			switch (direction) {
			case "up":
				// Loop
				var upTarget = (channels.length + (index - 1 + channels.length)) % channels.length;
				channels.eq(upTarget).click();
				break;

			case "down":
				// Loop
				var downTarget = (channels.length + (index + 1 + channels.length)) % channels.length;
				channels.eq(downTarget).click();
				break;
			}
		});

		Mousetrap.bind([
			"command+shift+l",
			"ctrl+shift+l"
		], function(e) {
			if (e.target === input[0]) {
				clear();
				e.preventDefault();
			}
		});

		Mousetrap.bind([
			"escape"
		], function() {
			contextMenuContainer.hide();
		});

		var colorsHotkeys = {
			k: "\x03",
			b: "\x02",
			u: "\x1F",
			i: "\x1D",
			o: "\x0F",
		};

		for (var hotkey in colorsHotkeys) {
			Mousetrap.bind([
				"command+" + hotkey,
				"ctrl+" + hotkey
			], function(e) {
				e.preventDefault();

				const cursorPosStart = input.prop("selectionStart");
				const cursorPosEnd = input.prop("selectionEnd");
				const value = input.val();
				let newValue = value.substring(0, cursorPosStart) + colorsHotkeys[e.key];

				if (cursorPosStart === cursorPosEnd) {
					// If no text is selected, insert at cursor
					newValue += value.substring(cursorPosEnd, value.length);
				} else {
					// If text is selected, insert formatting character at start and the end
					newValue += value.substring(cursorPosStart, cursorPosEnd) + colorsHotkeys[e.key] + value.substring(cursorPosEnd, value.length);
				}

				input
					.val(newValue)
					.get(0).setSelectionRange(cursorPosStart + 1, cursorPosEnd + 1);
			});
		}
	}());

	setInterval(function() {
		chat.find(".chan:not(.active)").each(function() {
			var chan = $(this);
			if (chan.find(".messages .msg").slice(0, -100).remove().length) {
				chan.find(".show-more").addClass("show");

				// Remove date-seperators that would otherwise be "stuck" at the top
				// of the channel
				chan.find(".date-marker").each(function() {
					if ($(this).next().hasClass("date-marker")) {
						$(this).remove();
					}
				});
			}
		});
	}, 1000 * 10);

	function clear() {
		chat.find(".active")
			.find(".show-more").addClass("show").end()
			.find(".messages .msg, .date-marker").remove();
	}

	function complete(word) {
		var words = commands.slice();
		var users = chat.find(".active").find(".users");
		var nicks = users.data("nicks");

		for (var i in nicks) {
			words.push(nicks[i]);
		}

		sidebar.find(".chan")
			.each(function() {
				var self = $(this);
				if (!self.hasClass("lobby")) {
					words.push(self.data("title"));
				}
			});

		return $.grep(
			words,
			function(w) {
				return !w.toLowerCase().indexOf(word.toLowerCase());
			}
		);
	}

	function confirmExit() {
		if ($("body").hasClass("public")) {
			window.onbeforeunload = function() {
				return "Are you sure you want to navigate away from this page?";
			};
		}
	}

	function sortable() {
		sidebar.find(".networks").sortable({
			axis: "y",
			containment: "parent",
			cursor: "move",
			distance: 12,
			items: ".network",
			handle: ".lobby",
			placeholder: "network-placeholder",
			forcePlaceholderSize: true,
			tolerance: "pointer", // Use the pointer to figure out where the network is in the list

			update: function() {
				var order = [];
				sidebar.find(".network").each(function() {
					var id = $(this).data("id");
					order.push(id);
				});
				socket.emit(
					"sort", {
						type: "networks",
						order: order
					}
				);

				ignoreSortSync = true;
			}
		});
		sidebar.find(".network").sortable({
			axis: "y",
			containment: "parent",
			cursor: "move",
			distance: 12,
			items: ".chan:not(.lobby)",
			placeholder: "chan-placeholder",
			forcePlaceholderSize: true,
			tolerance: "pointer", // Use the pointer to figure out where the channel is in the list

			update: function(e, ui) {
				var order = [];
				var network = ui.item.parent();
				network.find(".chan").each(function() {
					var id = $(this).data("id");
					order.push(id);
				});
				socket.emit(
					"sort", {
						type: "channels",
						target: network.data("id"),
						order: order
					}
				);

				ignoreSortSync = true;
			}
		});
	}

	socket.on("sync_sort", function(data) {
		// Syncs the order of channels or networks when they are reordered
		if (ignoreSortSync) {
			ignoreSortSync = false;
			return; // Ignore syncing because we 'caused' it
		}

		var type = data.type;
		var order = data.order;

		if (type === "networks") {
			var container = $(".networks");

			$.each(order, function(index, value) {
				var position = $(container.children()[index]);

				if (position.data("id") === value) { // Network in correct place
					return true; // No point in continuing
				}

				var network = container.find("#network-" + value);

				$(network).insertBefore(position);
			});
		} else if (type === "channels") {
			var network = $("#network-" + data.target);

			$.each(order, function(index, value) {
				if (index === 0) { // Shouldn't attempt to move lobby
					return true; // same as `continue` -> skip to next item
				}

				var position = $(network.children()[index]); // Target channel at position

				if (position.data("id") === value) { // Channel in correct place
					return true; // No point in continuing
				}

				var channel = network.find(".chan[data-id=" + value + "]"); // Channel at position

				$(channel).insertBefore(position);
			});
		}
	});

	function setNick(nick) {
		// Closes the nick editor when canceling, changing channel, or when a nick
		// is set in a different tab / browser / device.
		toggleNickEditor(false);

		$("#nick-value").text(nick);
	}

	function move(array, old_index, new_index) {
		if (new_index >= array.length) {
			var k = new_index - array.length;
			while ((k--) + 1) {
				this.push(undefined);
			}
		}
		array.splice(new_index, 0, array.splice(old_index, 1)[0]);
		return array;
	}

	function toggleNotificationMarkers(newState) {
		// Toggles the favicon to red when there are unread notifications
		if (favicon.data("toggled") !== newState) {
			var old = favicon.attr("href");
			favicon.attr("href", favicon.data("other"));
			favicon.data("other", old);
			favicon.data("toggled", newState);
		}

		// Toggles a dot on the menu icon when there are unread notifications
		$("#viewport .lt").toggleClass("notified", newState);
	}

	document.addEventListener(
		"visibilitychange",
		function() {
			if (sidebar.find(".highlight").length === 0) {
				toggleNotificationMarkers(false);
			}
		}
	);

	// Only start opening socket.io connection after all events have been registered
	socket.open();
});
