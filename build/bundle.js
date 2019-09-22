var App = (function () {
	'use strict';

	function noop() {}

	function assign(tar, src) {
		for (var k in src) tar[k] = src[k];
		return tar;
	}

	function run(fn) {
		return fn();
	}

	function blankObject() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	function create_slot(definition, ctx, fn) {
		if (definition) {
			const slot_ctx = get_slot_context(definition, ctx, fn);
			return definition[0](slot_ctx);
		}
	}

	function get_slot_context(definition, ctx, fn) {
		return definition[1]
			? assign({}, assign(ctx.$$scope.ctx, definition[1](fn ? fn(ctx) : {})))
			: ctx.$$scope.ctx;
	}

	function append(target, node) {
		target.appendChild(node);
	}

	function insert(target, node, anchor) {
		target.insertBefore(node, anchor);
	}

	function detachNode(node) {
		node.parentNode.removeChild(node);
	}

	function destroyEach(iterations, detach) {
		for (var i = 0; i < iterations.length; i += 1) {
			if (iterations[i]) iterations[i].d(detach);
		}
	}

	function createElement(name) {
		return document.createElement(name);
	}

	function createText(data) {
		return document.createTextNode(data);
	}

	function createComment() {
		return document.createComment('');
	}

	function addListener(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function children (element) {
		return Array.from(element.childNodes);
	}

	function setData(text, data) {
		text.data = '' + data;
	}

	function setStyle(node, key, value) {
		node.style.setProperty(key, value);
	}

	let outros;

	function group_outros() {
		outros = {
			remaining: 0,
			callbacks: []
		};
	}

	function check_outros() {
		if (!outros.remaining) {
			run_all(outros.callbacks);
		}
	}

	function on_outro(callback) {
		outros.callbacks.push(callback);
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error(`Function called outside component initialization`);
		return current_component;
	}

	function onMount(fn) {
		get_current_component().$$.on_mount.push(fn);
	}

	let dirty_components = [];

	let update_promise;
	const binding_callbacks = [];
	const render_callbacks = [];

	function schedule_update() {
		if (!update_promise) {
			update_promise = Promise.resolve();
			update_promise.then(flush);
		}
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	function flush() {
		const seen_callbacks = new Set();

		do {
			// first, call beforeUpdate functions
			// and update components
			while (dirty_components.length) {
				const component = dirty_components.shift();
				set_current_component(component);
				update(component.$$);
			}

			while (binding_callbacks.length) binding_callbacks.shift()();

			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			while (render_callbacks.length) {
				const callback = render_callbacks.pop();
				if (!seen_callbacks.has(callback)) {
					callback();

					// ...so guard against infinite loops
					seen_callbacks.add(callback);
				}
			}
		} while (dirty_components.length);

		update_promise = null;
	}

	function update($$) {
		if ($$.fragment) {
			$$.update($$.dirty);
			run_all($$.before_render);
			$$.fragment.p($$.dirty, $$.ctx);
			$$.dirty = null;

			$$.after_render.forEach(add_render_callback);
		}
	}

	function mount_component(component, target, anchor) {
		const { fragment, on_mount, on_destroy, after_render } = component.$$;

		fragment.m(target, anchor);

		// onMount happens after the initial afterUpdate. Because
		// afterUpdate callbacks happen in reverse order (inner first)
		// we schedule onMount callbacks before afterUpdate callbacks
		add_render_callback(() => {
			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case — component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});

		after_render.forEach(add_render_callback);
	}

	function destroy(component, detach) {
		if (component.$$) {
			run_all(component.$$.on_destroy);
			component.$$.fragment.d(detach);

			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			component.$$.on_destroy = component.$$.fragment = null;
			component.$$.ctx = {};
		}
	}

	function make_dirty(component, key) {
		if (!component.$$.dirty) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty = {};
		}
		component.$$.dirty[key] = true;
	}

	function init(component, options, instance, create_fragment, not_equal$$1) {
		const parent_component = current_component;
		set_current_component(component);

		const props = options.props || {};

		const $$ = component.$$ = {
			fragment: null,
			ctx: null,

			// state
			update: noop,
			not_equal: not_equal$$1,
			bound: blankObject(),

			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_render: [],
			after_render: [],
			context: new Map(parent_component ? parent_component.$$.context : []),

			// everything else
			callbacks: blankObject(),
			dirty: null
		};

		let ready = false;

		$$.ctx = instance
			? instance(component, props, (key, value) => {
				if ($$.bound[key]) $$.bound[key](value);

				if ($$.ctx) {
					const changed = not_equal$$1(value, $$.ctx[key]);
					if (ready && changed) {
						make_dirty(component, key);
					}

					$$.ctx[key] = value;
					return changed;
				}
			})
			: props;

		$$.update();
		ready = true;
		run_all($$.before_render);
		$$.fragment = create_fragment($$.ctx);

		if (options.target) {
			if (options.hydrate) {
				$$.fragment.l(children(options.target));
			} else {
				$$.fragment.c();
			}

			if (options.intro && component.$$.fragment.i) component.$$.fragment.i();
			mount_component(component, options.target, options.anchor);
			flush();
		}

		set_current_component(parent_component);
	}

	class SvelteComponent {
		$destroy() {
			destroy(this, true);
			this.$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set() {
			// overridden by instance, if it has props
		}
	}

	/* src/components/MenuIcon.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment(ctx) {
		var div3, div0, text0, div1, text1, div2, div3_class_value;

		return {
			c() {
				div3 = createElement("div");
				div0 = createElement("div");
				text0 = createText("\n  ");
				div1 = createElement("div");
				text1 = createText("\n  ");
				div2 = createElement("div");
				div0.className = "stripe-top svelte-3mmvey";
				div1.className = "stripe-middle svelte-3mmvey";
				div2.className = "stripe-bottom svelte-3mmvey";
				div3.className = div3_class_value = "container " + (ctx.menuToggled ? 'toggled' : '') + " svelte-3mmvey";
			},

			m(target, anchor) {
				insert(target, div3, anchor);
				append(div3, div0);
				append(div3, text0);
				append(div3, div1);
				append(div3, text1);
				append(div3, div2);
			},

			p(changed, ctx) {
				if ((changed.menuToggled) && div3_class_value !== (div3_class_value = "container " + (ctx.menuToggled ? 'toggled' : '') + " svelte-3mmvey")) {
					div3.className = div3_class_value;
				}
			},

			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(div3);
				}
			}
		};
	}

	function instance($$self, $$props, $$invalidate) {
		let { menuToggled = false } = $$props;

		$$self.$set = $$props => {
			if ('menuToggled' in $$props) $$invalidate('menuToggled', menuToggled = $$props.menuToggled);
		};

		return { menuToggled };
	}

	class MenuIcon extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance, create_fragment, safe_not_equal);
		}

		get menuToggled() {
			return this.$$.ctx.menuToggled;
		}

		set menuToggled(menuToggled) {
			this.$set({ menuToggled });
			flush();
		}
	}

	/* src/components/NavBar.html generated by Svelte v3.0.0-beta.3 */

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.link = list[i];
		return child_ctx;
	}

	// (6:10) {#each sections as link}
	function create_each_block(ctx) {
		var a, text_value = ctx.link.label, text, a_href_value, dispose;

		function click_handler(...args) {
			return ctx.click_handler(ctx, ...args);
		}

		return {
			c() {
				a = createElement("a");
				text = createText(text_value);
				a.href = a_href_value = "#" + ctx.link.id;
				a.className = "svelte-roshx";
				dispose = addListener(a, "click", click_handler);
			},

			m(target, anchor) {
				insert(target, a, anchor);
				append(a, text);
			},

			p(changed, new_ctx) {
				ctx = new_ctx;
			},

			d(detach) {
				if (detach) {
					detachNode(a);
				}

				dispose();
			}
		};
	}

	function create_fragment$1(ctx) {
		var header, div1, img, text0, nav, div0, div0_class_value, text1, button, current, dispose;

		var each_value = ctx.sections;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		var menuicon = new MenuIcon({ props: { menuToggled: ctx.menuToggled } });

		return {
			c() {
				header = createElement("header");
				div1 = createElement("div");
				img = createElement("img");
				text0 = createText("\n    ");
				nav = createElement("nav");
				div0 = createElement("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				text1 = createText("\n        ");
				button = createElement("button");
				menuicon.$$.fragment.c();
				img.className = "logo svelte-roshx";
				img.src = "/icons/gsg-logo.svg";
				img.alt = "GSG logo";
				div0.className = div0_class_value = "link-container " + (ctx.menuToggled ? 'active' : 'hidden') + " svelte-roshx";
				button.className = "menu-toggle svelte-roshx";
				div1.className = "navItems svelte-roshx";
				header.className = "svelte-roshx";
				dispose = addListener(button, "click", ctx.click_handler_1);
			},

			m(target, anchor) {
				insert(target, header, anchor);
				append(header, div1);
				append(div1, img);
				append(div1, text0);
				append(div1, nav);
				append(nav, div0);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div0, null);
				}

				append(nav, text1);
				append(nav, button);
				mount_component(menuicon, button, null);
				current = true;
			},

			p(changed, ctx) {
				if (changed.sections) {
					each_value = ctx.sections;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div0, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value.length;
				}

				if ((!current || changed.menuToggled) && div0_class_value !== (div0_class_value = "link-container " + (ctx.menuToggled ? 'active' : 'hidden') + " svelte-roshx")) {
					div0.className = div0_class_value;
				}

				var menuicon_changes = {};
				if (changed.menuToggled) menuicon_changes.menuToggled = ctx.menuToggled;
				menuicon.$set(menuicon_changes);
			},

			i(local) {
				if (current) return;
				menuicon.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				menuicon.$$.fragment.o(local);
				current = false;
			},

			d(detach) {
				if (detach) {
					detachNode(header);
				}

				destroyEach(each_blocks, detach);

				menuicon.$destroy();

				dispose();
			}
		};
	}

	function instance$1($$self, $$props, $$invalidate) {
		const sections = [
	    {
	      label: 'Home',
	      id: 'home',
	    },
	    {
	      label: 'Teams',
	      id: 'teams',
	    },
	    {
	      label: 'Club Leaders',
	      id: 'club-leaders',
	    },
	    {
	      label: 'Getting Involved',
	      id: 'getting-involved',
	    },
	    {
	      label: 'Contact Us',
	      id: 'contact-us',
	    }
	  ];

	  let menuToggled = false;

	  let scrollToSection = (event, sectionId) => {
	    event.preventDefault();
	    window.history.replaceState({}, '', '#' + sectionId);
	    document.getElementById(sectionId).scrollIntoView({
	      behavior: 'smooth',
	      block: 'start',
	    });
	    menuToggled = false; $$invalidate('menuToggled', menuToggled);
	  };

		function click_handler({ link }, event) {
			return scrollToSection(event, link.id);
		}

		function click_handler_1() {
			const $$result = menuToggled = !menuToggled;
			$$invalidate('menuToggled', menuToggled);
			return $$result;
		}

		return {
			sections,
			menuToggled,
			scrollToSection,
			click_handler,
			click_handler_1
		};
	}

	class NavBar extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$1, create_fragment$1, safe_not_equal);
		}
	}

	function writable(value) {
		const subscribers = [];

		function set(newValue) {
			if (newValue === value) return;
			value = newValue;
			subscribers.forEach(s => s[1]());
			subscribers.forEach(s => s[0](value));
		}

		function update(fn) {
			set(fn(value));
		}

		function subscribe(run$$1, invalidate = noop) {
			const subscriber = [run$$1, invalidate];
			subscribers.push(subscriber);
			run$$1(value);

			return () => {
				const index = subscribers.indexOf(subscriber);
				if (index !== -1) subscribers.splice(index, 1);
			};
		}

		return { set, update, subscribe };
	}

	const animationTriggers = writable({});

	/* src/components/PlayingCard.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$2(ctx) {
		var div3, div2, div0, text, div1, div3_class_value;

		const default_slot_1 = ctx.$$slot_default;
		const default_slot = create_slot(default_slot_1, ctx, null);

		return {
			c() {
				div3 = createElement("div");
				div2 = createElement("div");
				div0 = createElement("div");
				div0.innerHTML = `<img src="/icons/gsg-logo.svg" alt="Golden Swarm Games logo" class="svelte-ivio2s">`;
				text = createText("\n    ");
				div1 = createElement("div");

				if (default_slot) default_slot.c();
				div0.className = "front-face svelte-ivio2s";

				div1.className = "back-face svelte-ivio2s";
				div2.className = "inner svelte-ivio2s";
				div3.className = div3_class_value = "container " + (ctx.doubleSided ? 'doubleSidedCard' : '') + " " + ctx.size + " svelte-ivio2s";
			},

			l(nodes) {
				if (default_slot) default_slot.l(div1_nodes);
			},

			m(target, anchor) {
				insert(target, div3, anchor);
				append(div3, div2);
				append(div2, div0);
				append(div2, text);
				append(div2, div1);

				if (default_slot) {
					default_slot.m(div1, null);
				}
			},

			p(changed, ctx) {

				if (default_slot && changed.$$scope) {
					default_slot.p(assign(assign({},(changed)), ctx.$$scope.changed), get_slot_context(default_slot_1, ctx, null));
				}

				if ((changed.doubleSided || changed.size) && div3_class_value !== (div3_class_value = "container " + (ctx.doubleSided ? 'doubleSidedCard' : '') + " " + ctx.size + " svelte-ivio2s")) {
					div3.className = div3_class_value;
				}
			},

			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(div3);
				}

				if (default_slot) default_slot.d(detach);
			}
		};
	}

	function instance$2($$self, $$props, $$invalidate) {
		let { doubleSided = false, size = 'small' } = $$props;

		let { $$slot_default, $$scope } = $$props;

		$$self.$set = $$props => {
			if ('doubleSided' in $$props) $$invalidate('doubleSided', doubleSided = $$props.doubleSided);
			if ('size' in $$props) $$invalidate('size', size = $$props.size);
			if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
		};

		return {
			doubleSided,
			size,
			$$slot_default,
			$$scope
		};
	}

	class PlayingCard extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$2, create_fragment$2, safe_not_equal);
		}

		get doubleSided() {
			return this.$$.ctx.doubleSided;
		}

		set doubleSided(doubleSided) {
			this.$set({ doubleSided });
			flush();
		}

		get size() {
			return this.$$.ctx.size;
		}

		set size(size) {
			this.$set({ size });
			flush();
		}
	}

	/* src/sections/Banner.html generated by Svelte v3.0.0-beta.3 */

	function get_each_context$1(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.angle = list[i];
		return child_ctx;
	}

	// (3:4) {#each cards as angle}
	function create_each_block$1(ctx) {
		var div, current;

		var playingcard = new PlayingCard({});

		return {
			c() {
				div = createElement("div");
				playingcard.$$.fragment.c();
				div.className = "card svelte-12c082j";
				setStyle(div, "--angle", ctx.angle);
			},

			m(target, anchor) {
				insert(target, div, anchor);
				mount_component(playingcard, div, null);
				current = true;
			},

			p(changed, ctx) {
				if (!current || changed.cards) {
					setStyle(div, "--angle", ctx.angle);
				}
			},

			i(local) {
				if (current) return;
				playingcard.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				playingcard.$$.fragment.o(local);
				current = false;
			},

			d(detach) {
				if (detach) {
					detachNode(div);
				}

				playingcard.$destroy();
			}
		};
	}

	function create_fragment$3(ctx) {
		var section, div, text, hgroup, current;

		var each_value = ctx.cards;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
		}

		function outroBlock(i, detach, local) {
			if (each_blocks[i]) {
				if (detach) {
					on_outro(() => {
						each_blocks[i].d(detach);
						each_blocks[i] = null;
					});
				}

				each_blocks[i].o(local);
			}
		}

		return {
			c() {
				section = createElement("section");
				div = createElement("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				text = createText("\n  ");
				hgroup = createElement("hgroup");
				hgroup.innerHTML = `<h1 style="--offset: -5rem" class="svelte-12c082j">Golden</h1>
			    <h1 class="accented svelte-12c082j">Swarm</h1>
			    <h1 style="--offset: 5rem" class="svelte-12c082j">Games</h1>`;
				div.className = "card-container svelte-12c082j";
				hgroup.className = "svelte-12c082j";
				section.className = "container svelte-12c082j";
				section.id = ctx.sectionId;
			},

			m(target, anchor) {
				insert(target, section, anchor);
				append(section, div);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div, null);
				}

				append(section, text);
				append(section, hgroup);
				current = true;
			},

			p(changed, ctx) {
				if (changed.cards) {
					each_value = ctx.cards;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context$1(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
							each_blocks[i].i(1);
						} else {
							each_blocks[i] = create_each_block$1(child_ctx);
							each_blocks[i].c();
							each_blocks[i].i(1);
							each_blocks[i].m(div, null);
						}
					}

					group_outros();
					for (; i < each_blocks.length; i += 1) outroBlock(i, 1, 1);
					check_outros();
				}

				if (!current || changed.sectionId) {
					section.id = ctx.sectionId;
				}
			},

			i(local) {
				if (current) return;
				for (var i = 0; i < each_value.length; i += 1) each_blocks[i].i();

				current = true;
			},

			o(local) {
				each_blocks = each_blocks.filter(Boolean);
				for (let i = 0; i < each_blocks.length; i += 1) outroBlock(i, 0);

				current = false;
			},

			d(detach) {
				if (detach) {
					detachNode(section);
				}

				destroyEach(each_blocks, detach);
			}
		};
	}

	function instance$3($$self, $$props, $$invalidate) {
		const cards = ['-10deg', '5deg', '20deg'];

	  let { sectionId } = $$props;

		$$self.$set = $$props => {
			if ('sectionId' in $$props) $$invalidate('sectionId', sectionId = $$props.sectionId);
		};

		return { cards, sectionId };
	}

	class Banner extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$3, create_fragment$3, safe_not_equal);
		}

		get sectionId() {
			return this.$$.ctx.sectionId;
		}

		set sectionId(sectionId) {
			this.$set({ sectionId });
			flush();
		}
	}

	/* src/sections/AboutBlurb.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$4(ctx) {
		var section;

		return {
			c() {
				section = createElement("section");
				section.innerHTML = `<h2>A Brief History</h2>
			  <p class="svelte-rmn9gl">
			    We're a new club at <a href="https://gatech.edu">Georgia Tech</a> all about
			    making our own board games! We're currently building our first ever game
			    <i>Escape to Elysium.</i> Members of all interests are welcome. Between
			    designing artwork, marketing, or just coming up with crazy ideas, you'll
			    definitely find your place :)
			  </p>`;
				section.className = "svelte-rmn9gl";
			},

			m(target, anchor) {
				insert(target, section, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(section);
				}
			}
		};
	}

	class AboutBlurb extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$4, safe_not_equal);
		}
	}

	/* src/sections/Timeline.html generated by Svelte v3.0.0-beta.3 */

	function get_each_context_1(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.infoText = list[i];
		return child_ctx;
	}

	function get_each_context$2(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.item = list[i];
		return child_ctx;
	}

	// (5:6) {#if !item.ongoing}
	function create_if_block(ctx) {
		var img;

		return {
			c() {
				img = createElement("img");
				img.src = "/icons/check.svg";
				img.alt = "checkmark";
			},

			m(target, anchor) {
				insert(target, img, anchor);
			},

			d(detach) {
				if (detach) {
					detachNode(img);
				}
			}
		};
	}

	// (11:6) {#each item.info as infoText}
	function create_each_block_1(ctx) {
		var li, text_value = ctx.infoText, text;

		return {
			c() {
				li = createElement("li");
				text = createText(text_value);
				li.className = "svelte-ysnbq0";
			},

			m(target, anchor) {
				insert(target, li, anchor);
				append(li, text);
			},

			p: noop,

			d(detach) {
				if (detach) {
					detachNode(li);
				}
			}
		};
	}

	// (2:2) {#each items as item}
	function create_each_block$2(ctx) {
		var div1, div0, div0_class_value, text0, ul, h3, text1_value = ctx.item.timeframe, text1, text2;

		var if_block = (!ctx.item.ongoing) && create_if_block(ctx);

		var each_value_1 = ctx.item.info;

		var each_blocks = [];

		for (var i = 0; i < each_value_1.length; i += 1) {
			each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
		}

		return {
			c() {
				div1 = createElement("div");
				div0 = createElement("div");
				if (if_block) if_block.c();
				text0 = createText("\n    ");
				ul = createElement("ul");
				h3 = createElement("h3");
				text1 = createText(text1_value);
				text2 = createText("\n      ");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}
				div0.className = div0_class_value = "circle " + (ctx.item.ongoing ? 'ongoing' : '') + " svelte-ysnbq0";
				h3.className = "svelte-ysnbq0";
				ul.className = "text svelte-ysnbq0";
				div1.className = "item svelte-ysnbq0";
			},

			m(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				if (if_block) if_block.m(div0, null);
				append(div1, text0);
				append(div1, ul);
				append(ul, h3);
				append(h3, text1);
				append(ul, text2);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(ul, null);
				}
			},

			p(changed, ctx) {
				if (!ctx.item.ongoing) {
					if (!if_block) {
						if_block = create_if_block(ctx);
						if_block.c();
						if_block.m(div0, null);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}

				if (changed.items) {
					each_value_1 = ctx.item.info;

					for (var i = 0; i < each_value_1.length; i += 1) {
						const child_ctx = get_each_context_1(ctx, each_value_1, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block_1(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(ul, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value_1.length;
				}
			},

			d(detach) {
				if (detach) {
					detachNode(div1);
				}

				if (if_block) if_block.d();

				destroyEach(each_blocks, detach);
			}
		};
	}

	function create_fragment$5(ctx) {
		var section, text, div;

		var each_value = ctx.items;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block$2(get_each_context$2(ctx, each_value, i));
		}

		return {
			c() {
				section = createElement("section");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				text = createText("\n  ");
				div = createElement("div");
				div.className = "timeline-bar svelte-ysnbq0";
				section.id = ctx.sectionId;
				section.className = "svelte-ysnbq0";
			},

			m(target, anchor) {
				insert(target, section, anchor);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(section, null);
				}

				append(section, text);
				append(section, div);
			},

			p(changed, ctx) {
				if (changed.items) {
					each_value = ctx.items;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context$2(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block$2(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(section, text);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value.length;
				}

				if (changed.sectionId) {
					section.id = ctx.sectionId;
				}
			},

			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(section);
				}

				destroyEach(each_blocks, detach);
			}
		};
	}

	function instance$4($$self, $$props, $$invalidate) {
		
	  const items = [
	    {
	      timeframe: 'Fall 2017',
	      info: [
	        'Humbly began in ENG 1102 with the topic "The Art of Game Design"',
	        'Escape to Elysium’s first major iteration completed',
	      ],
	    },
	    {
	      timeframe: 'Spring 2018',
	      info: [
	        'Club officially chartered and organized',
	        'Gained some fabulous new members',
	      ],
	    },
	    {
	      timeframe: 'Fall 2018 - Present',
	      info: [
	        'Finalizing second major iteration of Escape to Elysium',
	        'Pushing for marketing with production in the works!',
	      ],
	      ongoing: true,
	    },
	  ];

	  onMount(() => {
	    animationTriggers.set({
	      ...$animationTriggers,
	      ['#' + sectionId]: false,
	    });
	  });

	  let { sectionId } = $$props;

		let $animationTriggers;
		$$self.$$.on_destroy.push(animationTriggers.subscribe($$value => { $animationTriggers = $$value; $$invalidate('$animationTriggers', $animationTriggers); }));

		$$self.$set = $$props => {
			if ('sectionId' in $$props) $$invalidate('sectionId', sectionId = $$props.sectionId);
		};

		return { items, sectionId };
	}

	class Timeline extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$4, create_fragment$5, safe_not_equal);
		}

		get sectionId() {
			return this.$$.ctx.sectionId;
		}

		set sectionId(sectionId) {
			this.$set({ sectionId });
			flush();
		}
	}

	/* src/sections/teamSections/Design.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$6(ctx) {
		var p0, text2, p1, text4, p2;

		return {
			c() {
				p0 = createElement("p");
				p0.innerHTML = `<strong>The design team</strong> is more than just making things look nice
			  (but that is certainly part of it).
			`;
				text2 = createText("\n");
				p1 = createElement("p");
				p1.textContent = "We have our hands in every part of the game creation process, from menacing\n  monster sketches to working out turn-based combat.";
				text4 = createText("\n");
				p2 = createElement("p");
				p2.textContent = "If you’re an imaginative writer, a Photoshop warrior, or a sketchbook Picasso,\n  this is the team for you!";
			},

			m(target, anchor) {
				insert(target, p0, anchor);
				insert(target, text2, anchor);
				insert(target, p1, anchor);
				insert(target, text4, anchor);
				insert(target, p2, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(p0);
					detachNode(text2);
					detachNode(p1);
					detachNode(text4);
					detachNode(p2);
				}
			}
		};
	}

	class Design extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$6, safe_not_equal);
		}
	}

	/* src/sections/teamSections/Production.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$7(ctx) {
		var p0, text2, p1, text4, p2;

		return {
			c() {
				p0 = createElement("p");
				p0.innerHTML = `<strong>The production team</strong> is all about the business side. What good
			  is a beautiful game if no one can have it?
			`;
				text2 = createText("\n");
				p1 = createElement("p");
				p1.textContent = "All you Scheller maniacs out there should find a home here, along with anyone\n  curious about how to take an idea to a shiny new product.";
				text4 = createText("\n");
				p2 = createElement("p");
				p2.textContent = "This is one of our under-served teams so anyone interested will get a warm\n  welcome!";
			},

			m(target, anchor) {
				insert(target, p0, anchor);
				insert(target, text2, anchor);
				insert(target, p1, anchor);
				insert(target, text4, anchor);
				insert(target, p2, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(p0);
					detachNode(text2);
					detachNode(p1);
					detachNode(text4);
					detachNode(p2);
				}
			}
		};
	}

	class Production extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$7, safe_not_equal);
		}
	}

	/* src/sections/teamSections/Marketing.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$8(ctx) {
		var p0, text2, p1, text4, p2;

		return {
			c() {
				p0 = createElement("p");
				p0.innerHTML = `<strong>The marketing team</strong> handles everything about the "Golden Swarm
			  Games" brand.
			`;
				text2 = createText("\n");
				p1 = createElement("p");
				p1.textContent = "Those with unhealthy addictions to social media are encouraged to check this\n  team out, as well as those with an eye for photography.";
				text4 = createText("\n");
				p2 = createElement("p");
				p2.textContent = "The club has been gaining a lot of traction this semester, so we need someone\n  to shout our name from the rooftops!";
			},

			m(target, anchor) {
				insert(target, p0, anchor);
				insert(target, text2, anchor);
				insert(target, p1, anchor);
				insert(target, text4, anchor);
				insert(target, p2, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(p0);
					detachNode(text2);
					detachNode(p1);
					detachNode(text4);
					detachNode(p2);
				}
			}
		};
	}

	class Marketing extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$8, safe_not_equal);
		}
	}

	/* src/components/IconSwitcher.html generated by Svelte v3.0.0-beta.3 */

	function get_each_context$3(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.icon = list[i];
		child_ctx.i = i;
		return child_ctx;
	}

	// (2:2) {#each icons as icon, i}
	function create_each_block$3(ctx) {
		var img, img_src_value, img_class_value;

		return {
			c() {
				img = createElement("img");
				img.src = img_src_value = "/icons/" + ctx.icon;
				img.className = img_class_value = "" + (ctx.i === ctx.index ? 'selected' : '') + " svelte-1eu0xov";
				img.alt = "Team icon";
			},

			m(target, anchor) {
				insert(target, img, anchor);
			},

			p(changed, ctx) {
				if ((changed.icons) && img_src_value !== (img_src_value = "/icons/" + ctx.icon)) {
					img.src = img_src_value;
				}

				if ((changed.index) && img_class_value !== (img_class_value = "" + (ctx.i === ctx.index ? 'selected' : '') + " svelte-1eu0xov")) {
					img.className = img_class_value;
				}
			},

			d(detach) {
				if (detach) {
					detachNode(img);
				}
			}
		};
	}

	function create_fragment$9(ctx) {
		var div, div_class_value;

		var each_value = ctx.icons;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block$3(get_each_context$3(ctx, each_value, i));
		}

		return {
			c() {
				div = createElement("div");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}
				div.className = div_class_value = "" + (ctx.animate ? 'animate' : '') + " svelte-1eu0xov";
			},

			m(target, anchor) {
				insert(target, div, anchor);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(div, null);
				}
			},

			p(changed, ctx) {
				if (changed.icons || changed.index) {
					each_value = ctx.icons;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context$3(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
						} else {
							each_blocks[i] = create_each_block$3(child_ctx);
							each_blocks[i].c();
							each_blocks[i].m(div, null);
						}
					}

					for (; i < each_blocks.length; i += 1) {
						each_blocks[i].d(1);
					}
					each_blocks.length = each_value.length;
				}

				if ((changed.animate) && div_class_value !== (div_class_value = "" + (ctx.animate ? 'animate' : '') + " svelte-1eu0xov")) {
					div.className = div_class_value;
				}
			},

			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(div);
				}

				destroyEach(each_blocks, detach);
			}
		};
	}

	function instance$5($$self, $$props, $$invalidate) {
		let { icons = [], index = 0, animLength = 0, animate: animate$$1 = false } = $$props;

		$$self.$set = $$props => {
			if ('icons' in $$props) $$invalidate('icons', icons = $$props.icons);
			if ('index' in $$props) $$invalidate('index', index = $$props.index);
			if ('animLength' in $$props) $$invalidate('animLength', animLength = $$props.animLength);
			if ('animate' in $$props) $$invalidate('animate', animate$$1 = $$props.animate);
		};

		return { icons, index, animLength, animate: animate$$1 };
	}

	class IconSwitcher extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$5, create_fragment$9, safe_not_equal);
		}

		get icons() {
			return this.$$.ctx.icons;
		}

		set icons(icons) {
			this.$set({ icons });
			flush();
		}

		get index() {
			return this.$$.ctx.index;
		}

		set index(index) {
			this.$set({ index });
			flush();
		}

		get animLength() {
			return this.$$.ctx.animLength;
		}

		set animLength(animLength) {
			this.$set({ animLength });
			flush();
		}

		get animate() {
			return this.$$.ctx.animate;
		}

		set animate(animate$$1) {
			this.$set({ animate: animate$$1 });
			flush();
		}
	}

	/* src/sections/Teams.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$a(ctx) {
		var section, h2, text1, p, text2_value = ctx.curr.label, text2, text3, text4, div0, text5, div1, button0, text6, button1, section_class_value, current, dispose;

		var iconswitcher = new IconSwitcher({
			props: {
			animate: ctx.animate,
			animLength: wipeAnimLength,
			icons: ctx.sections.map(func),
			index: ctx.currIndex
		}
		});

		var switch_value = ctx.curr.component;

		function switch_props(ctx) {
			return {};
		}

		if (switch_value) {
			var switch_instance = new switch_value(switch_props(ctx));
		}

		return {
			c() {
				section = createElement("section");
				h2 = createElement("h2");
				h2.textContent = "Teams";
				text1 = createText("\n  ");
				p = createElement("p");
				text2 = createText(text2_value);
				text3 = createText("\n  ");
				iconswitcher.$$.fragment.c();
				text4 = createText("\n  ");
				div0 = createElement("div");
				if (switch_instance) switch_instance.$$.fragment.c();
				text5 = createText("\n  ");
				div1 = createElement("div");
				button0 = createElement("button");
				text6 = createText("\n    ");
				button1 = createElement("button");
				h2.className = "svelte-cqoj3o";
				p.className = "backing-text svelte-cqoj3o";
				div0.className = "text-container svelte-cqoj3o";
				button0.className = "back svelte-cqoj3o";
				button1.className = "forward svelte-cqoj3o";
				div1.className = "buttons svelte-cqoj3o";
				section.className = section_class_value = "" + (ctx.animate ? 'wipe' : '') + " svelte-cqoj3o";
				setStyle(section, "--anim-length", wipeAnimLength);
				section.id = ctx.sectionId;

				dispose = [
					addListener(button0, "click", ctx.onBack),
					addListener(button1, "click", ctx.onForward)
				];
			},

			m(target, anchor) {
				insert(target, section, anchor);
				append(section, h2);
				append(section, text1);
				append(section, p);
				append(p, text2);
				append(section, text3);
				mount_component(iconswitcher, section, null);
				append(section, text4);
				append(section, div0);

				if (switch_instance) {
					mount_component(switch_instance, div0, null);
				}

				append(section, text5);
				append(section, div1);
				append(div1, button0);
				append(div1, text6);
				append(div1, button1);
				current = true;
			},

			p(changed, ctx) {
				if ((!current || changed.curr) && text2_value !== (text2_value = ctx.curr.label)) {
					setData(text2, text2_value);
				}

				var iconswitcher_changes = {};
				if (changed.animate) iconswitcher_changes.animate = ctx.animate;
				if (changed.wipeAnimLength) iconswitcher_changes.animLength = wipeAnimLength;
				if (changed.sections) iconswitcher_changes.icons = ctx.sections.map(func);
				if (changed.currIndex) iconswitcher_changes.index = ctx.currIndex;
				iconswitcher.$set(iconswitcher_changes);

				if (switch_value !== (switch_value = ctx.curr.component)) {
					if (switch_instance) {
						group_outros();
						const old_component = switch_instance;
						on_outro(() => {
							old_component.$destroy();
						});
						old_component.$$.fragment.o(1);
						check_outros();
					}

					if (switch_value) {
						switch_instance = new switch_value(switch_props(ctx));

						switch_instance.$$.fragment.c();
						switch_instance.$$.fragment.i(1);
						mount_component(switch_instance, div0, null);
					} else {
						switch_instance = null;
					}
				}

				if ((!current || changed.animate) && section_class_value !== (section_class_value = "" + (ctx.animate ? 'wipe' : '') + " svelte-cqoj3o")) {
					section.className = section_class_value;
				}

				if (!current || changed.wipeAnimLength) {
					setStyle(section, "--anim-length", wipeAnimLength);
				}

				if (!current || changed.sectionId) {
					section.id = ctx.sectionId;
				}
			},

			i(local) {
				if (current) return;
				iconswitcher.$$.fragment.i(local);

				if (switch_instance) switch_instance.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				iconswitcher.$$.fragment.o(local);
				if (switch_instance) switch_instance.$$.fragment.o(local);
				current = false;
			},

			d(detach) {
				if (detach) {
					detachNode(section);
				}

				iconswitcher.$destroy();

				if (switch_instance) switch_instance.$destroy();
				run_all(dispose);
			}
		};
	}

	const wipeAnimLength = 0.8;

	function func(section) {
		return section.icon;
	}

	function instance$6($$self, $$props, $$invalidate) {
		

	  const sections = [
	    {
	      label: 'Design',
	      component: Design,
	      icon: 'horse.svg',
	    },
	    {
	      label: 'Prod',
	      component: Production,
	      icon: 'rook.svg',
	    },
	    {
	      label: 'Mrkting',
	      component: Marketing,
	      icon: 'bishop.svg',
	    }
	  ];

	  const onForward = () => {
	    currIndex = (currIndex + 1) % sections.length; $$invalidate('currIndex', currIndex);
	    startAnimation();
	  };

	  const onBack = () => {
	    currIndex = currIndex === 0 ? sections.length - 1 : currIndex - 1; $$invalidate('currIndex', currIndex);
	    startAnimation();
	  };

	  const startAnimation = () => {
	    animate$$1 = true; $$invalidate('animate', animate$$1);
	    setTimeout(() => {
	      curr = sections[currIndex]; $$invalidate('curr', curr);
	      setTimeout(() => {
	        animate$$1 = false; $$invalidate('animate', animate$$1);
	      }, wipeAnimLength * 500);
	    }, wipeAnimLength * 500);
	  };

	  let currIndex = 0;
	  let curr = sections[currIndex];
	  let animate$$1 = false;
	  let { sectionId = '' } = $$props;

		$$self.$set = $$props => {
			if ('sectionId' in $$props) $$invalidate('sectionId', sectionId = $$props.sectionId);
		};

		return {
			sections,
			onForward,
			onBack,
			currIndex,
			curr,
			animate: animate$$1,
			sectionId
		};
	}

	class Teams extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$6, create_fragment$a, safe_not_equal);
		}

		get sectionId() {
			return this.$$.ctx.sectionId;
		}

		set sectionId(sectionId) {
			this.$set({ sectionId });
			flush();
		}
	}

	/* src/sections/ClubLeaders.html generated by Svelte v3.0.0-beta.3 */

	function get_each_context$4(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.leader = list[i];
		return child_ctx;
	}

	// (4:2) <PlayingCard size="large" doubleSided="{true}">
	function create_default_slot(ctx) {
		var div0, text0, p0, text1_value = ctx.leader.type, text1, p0_class_value, text2, div2, div1, img, img_src_value, img_alt_value, text3, h3, text4_value = ctx.leader.name, text4, text5, p1, text6_value = ctx.leader.description, text6, text7;

		return {
			c() {
				div0 = createElement("div");
				text0 = createText("\n    ");
				p0 = createElement("p");
				text1 = createText(text1_value);
				text2 = createText("\n    ");
				div2 = createElement("div");
				div1 = createElement("div");
				img = createElement("img");
				text3 = createText("\n    ");
				h3 = createElement("h3");
				text4 = createText(text4_value);
				text5 = createText("\n    ");
				p1 = createElement("p");
				text6 = createText(text6_value);
				text7 = createText("\n  ");
				div0.className = "accent svelte-nblbdj";
				p0.className = p0_class_value = "type " + ctx.leader.type + " svelte-nblbdj";
				img.src = img_src_value = ctx.leader.image;
				img.alt = img_alt_value = "" + ctx.leader.name + " profile picture";
				img.className = "svelte-nblbdj";
				div1.className = "image-border svelte-nblbdj";
				div2.className = "image-container svelte-nblbdj";
				p1.className = "description svelte-nblbdj";
			},

			m(target, anchor) {
				insert(target, div0, anchor);
				insert(target, text0, anchor);
				insert(target, p0, anchor);
				append(p0, text1);
				insert(target, text2, anchor);
				insert(target, div2, anchor);
				append(div2, div1);
				append(div1, img);
				insert(target, text3, anchor);
				insert(target, h3, anchor);
				append(h3, text4);
				insert(target, text5, anchor);
				insert(target, p1, anchor);
				append(p1, text6);
				insert(target, text7, anchor);
			},

			p: noop,

			d(detach) {
				if (detach) {
					detachNode(div0);
					detachNode(text0);
					detachNode(p0);
					detachNode(text2);
					detachNode(div2);
					detachNode(text3);
					detachNode(h3);
					detachNode(text5);
					detachNode(p1);
					detachNode(text7);
				}
			}
		};
	}

	// (3:2) {#each leaders as leader}
	function create_each_block$4(ctx) {
		var current;

		var playingcard = new PlayingCard({
			props: {
			size: "large",
			doubleSided: true,
			$$slot_default: [create_default_slot],
			$$scope: { ctx }
		}
		});

		return {
			c() {
				playingcard.$$.fragment.c();
			},

			m(target, anchor) {
				mount_component(playingcard, target, anchor);
				current = true;
			},

			p: noop,

			i(local) {
				if (current) return;
				playingcard.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				playingcard.$$.fragment.o(local);
				current = false;
			},

			d(detach) {
				playingcard.$destroy(detach);
			}
		};
	}

	function create_fragment$b(ctx) {
		var section, h2, text_1, current;

		var each_value = ctx.leaders;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block$4(get_each_context$4(ctx, each_value, i));
		}

		function outroBlock(i, detach, local) {
			if (each_blocks[i]) {
				if (detach) {
					on_outro(() => {
						each_blocks[i].d(detach);
						each_blocks[i] = null;
					});
				}

				each_blocks[i].o(local);
			}
		}

		return {
			c() {
				section = createElement("section");
				h2 = createElement("h2");
				h2.textContent = "Our leaders";
				text_1 = createText("\n  ");

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}
				section.id = ctx.sectionId;
				section.className = "svelte-nblbdj";
			},

			m(target, anchor) {
				insert(target, section, anchor);
				append(section, h2);
				append(section, text_1);

				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(section, null);
				}

				current = true;
			},

			p(changed, ctx) {
				if (changed.leaders) {
					each_value = ctx.leaders;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context$4(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
							each_blocks[i].i(1);
						} else {
							each_blocks[i] = create_each_block$4(child_ctx);
							each_blocks[i].c();
							each_blocks[i].i(1);
							each_blocks[i].m(section, null);
						}
					}

					group_outros();
					for (; i < each_blocks.length; i += 1) outroBlock(i, 1, 1);
					check_outros();
				}

				if (!current || changed.sectionId) {
					section.id = ctx.sectionId;
				}
			},

			i(local) {
				if (current) return;
				for (var i = 0; i < each_value.length; i += 1) each_blocks[i].i();

				current = true;
			},

			o(local) {
				each_blocks = each_blocks.filter(Boolean);
				for (let i = 0; i < each_blocks.length; i += 1) outroBlock(i, 0);

				current = false;
			},

			d(detach) {
				if (detach) {
					detachNode(section);
				}

				destroyEach(each_blocks, detach);
			}
		};
	}

	function instance$7($$self, $$props, $$invalidate) {
		

	  const applyNbsp = text => text.split(' ').join('\u00a0');
	  const leaders = [
	    {
	      name: 'Mary Xu',
	      description: 'Club overlord and design extraordinaire',
	      image: '/images/Mary-profile.jpg',
	      type: 'Exec',
	    },
	    {
	      name: 'Jacob Allen',
	      description: 'Vice president / Vice principal',
	      image: '/images/Jacob-profile.jpg',
	      type: 'Exec',
	    },
	    {
	      name: 'Maxwell Forsyth',
	      description: 'Secretary / Email communications wizard',
	      image: '/images/Maxwell-profile.jpg',
	      type: 'Exec',
	    },
	    {
	      name: 'Rishov Sarkar',
	      description: 'Treasurer that handles those clams',
	      image: '/images/Rishov-profile.jpg',
	      type: 'Exec',
	    },
	    {
	      name: 'Alexa Flesch',
	      description: `Vengeful co-lead of design ${applyNbsp(
        'a e s t h e t i c'
      )}`,
	      image: '/images/Alexa-profile.jpg',
	      type: 'Lead',
	    },
	    {
	      name: 'Nicholas Wong',
	      description: 'Meniacal co-lead of design and game rules',
	      image: '/images/Nick-profile.jpg',
	      type: 'Lead',
	    },
	    {
	      name: 'Rocio Soto',
	      description: 'Lone wolf queen of marketing',
	      image: '/images/Rocio-profile.jpg',
	      type: 'Lead',
	    },
	    {
	      name: 'Vishal Shah',
	      description: 'Grand conductor of production',
	      image: '/images/Vishal-profile.jpg',
	      type: 'Lead',
	    },
	    {
	      name: 'Ben Holmes',
	      description: 'All-knowing web sorceror 🔮',
	      image: '/images/BenH-profile.jpg',
	      type: 'Lead',
	    },
	  ];

	  onMount(() => {
	    animationTriggers.set({
	      ...$animationTriggers,
	      '.doubleSidedCard': false,
	      ['#' + sectionId]: false,
	    });
	  });

	  let { sectionId } = $$props;

		let $animationTriggers;
		$$self.$$.on_destroy.push(animationTriggers.subscribe($$value => { $animationTriggers = $$value; $$invalidate('$animationTriggers', $animationTriggers); }));

		$$self.$set = $$props => {
			if ('sectionId' in $$props) $$invalidate('sectionId', sectionId = $$props.sectionId);
		};

		return { leaders, sectionId };
	}

	class ClubLeaders extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$7, create_fragment$b, safe_not_equal);
		}

		get sectionId() {
			return this.$$.ctx.sectionId;
		}

		set sectionId(sectionId) {
			this.$set({ sectionId });
			flush();
		}
	}

	/* src/components/CalendarEmbed.html generated by Svelte v3.0.0-beta.3 */

	/* src/sections/GetInvolved.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$d(ctx) {
		var section, h2, text1, p, text3, ul, text9, div;

		return {
			c() {
				section = createElement("section");
				h2 = createElement("h2");
				h2.textContent = "Get Involved";
				text1 = createText("\n  ");
				p = createElement("p");
				p.textContent = "We're always open to new members stopping by! Generally, we have";
				text3 = createText("\n  ");
				ul = createElement("ul");
				ul.innerHTML = `<li class="svelte-ythzql"><strong class="svelte-ythzql">General meetings Thursdays 7-8PM</strong> to touch base on each
			      department's progress
			    </li>
			    <li class="svelte-ythzql"><strong class="svelte-ythzql">Work days Saturdays 2-4PM</strong> to run play tests of our game
			      and collaborate on new ideas
			    </li>`;
				text9 = createText("\n  ");
				div = createElement("div");
				div.innerHTML = `<iframe title="Event Calendar" src="https://teamup.com/kstmf67ugzsq6jd4q2?showHeader=0&view=m&disableSidepanel=1" frameborder="0" height="100%" width="100%"></iframe>`;
				ul.className = "svelte-ythzql";
				div.className = "calendar-container svelte-ythzql";
				section.id = ctx.sectionId;
				section.className = "svelte-ythzql";
			},

			m(target, anchor) {
				insert(target, section, anchor);
				append(section, h2);
				append(section, text1);
				append(section, p);
				append(section, text3);
				append(section, ul);
				append(section, text9);
				append(section, div);
			},

			p(changed, ctx) {
				if (changed.sectionId) {
					section.id = ctx.sectionId;
				}
			},

			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(section);
				}
			}
		};
	}

	function instance$8($$self, $$props, $$invalidate) {
		let { sectionId } = $$props;

		$$self.$set = $$props => {
			if ('sectionId' in $$props) $$invalidate('sectionId', sectionId = $$props.sectionId);
		};

		return { sectionId };
	}

	class GetInvolved extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$8, create_fragment$d, safe_not_equal);
		}

		get sectionId() {
			return this.$$.ctx.sectionId;
		}

		set sectionId(sectionId) {
			this.$set({ sectionId });
			flush();
		}
	}

	/* src/sections/ContactUs.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$e(ctx) {
		var section, div;

		return {
			c() {
				section = createElement("section");
				div = createElement("div");
				div.innerHTML = `<h2>Contact Us</h2>
			    <p class="svelte-1igrjag"><strong class="svelte-1igrjag">Email </strong>
			      <a href="mailto:goldenswarmgames@lists.gatech.edu" class="svelte-1igrjag">
			        goldenswarmgames@lists<wbr>.gatech.edu
			      </a></p>
			    <p class="svelte-1igrjag"><strong class="svelte-1igrjag">GroupMe </strong><a href="https://bit.ly/2TamyCt" class="svelte-1igrjag">https://bit.ly/2TamyCt</a></p>
			    <p class="svelte-1igrjag"><strong class="svelte-1igrjag">Slack </strong>goldenswarmgames.slack.com</p>
			    <p class="backing-text svelte-1igrjag">Contact us</p>`;
				div.className = "container svelte-1igrjag";
				section.id = ctx.sectionId;
				section.className = "svelte-1igrjag";
			},

			m(target, anchor) {
				insert(target, section, anchor);
				append(section, div);
			},

			p(changed, ctx) {
				if (changed.sectionId) {
					section.id = ctx.sectionId;
				}
			},

			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(section);
				}
			}
		};
	}

	function instance$9($$self, $$props, $$invalidate) {
		let { sectionId = '' } = $$props;

		$$self.$set = $$props => {
			if ('sectionId' in $$props) $$invalidate('sectionId', sectionId = $$props.sectionId);
		};

		return { sectionId };
	}

	class ContactUs extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$9, create_fragment$e, safe_not_equal);
		}

		get sectionId() {
			return this.$$.ctx.sectionId;
		}

		set sectionId(sectionId) {
			this.$set({ sectionId });
			flush();
		}
	}

	/* src/sections/Content.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$f(ctx) {
		var main, div, div_class_value, text0, text1, text2, text3, text4, text5, text6, current;

		var banner = new Banner({ props: { sectionId: "home" } });

		var aboutblurb = new AboutBlurb({});

		var timeline = new Timeline({ props: { sectionId: "timeline" } });

		var teams = new Teams({ props: { sectionId: "teams" } });

		var clubleaders = new ClubLeaders({ props: { sectionId: "club-leaders" } });

		var getinvolved = new GetInvolved({ props: { sectionId: "getting-involved" } });

		var contactus = new ContactUs({ props: { sectionId: "contact-us" } });

		return {
			c() {
				main = createElement("main");
				div = createElement("div");
				text0 = createText("\n  ");
				banner.$$.fragment.c();
				text1 = createText("\n  ");
				aboutblurb.$$.fragment.c();
				text2 = createText("\n  ");
				timeline.$$.fragment.c();
				text3 = createText("\n  ");
				teams.$$.fragment.c();
				text4 = createText("\n  ");
				clubleaders.$$.fragment.c();
				text5 = createText("\n  ");
				getinvolved.$$.fragment.c();
				text6 = createText("\n  ");
				contactus.$$.fragment.c();
				div.className = div_class_value = "stripe " + (ctx.increaseStripeAngle ? 'increase-angle' : '') + " svelte-178lsdy";
				main.className = "svelte-178lsdy";
			},

			m(target, anchor) {
				insert(target, main, anchor);
				append(main, div);
				append(main, text0);
				mount_component(banner, main, null);
				append(main, text1);
				mount_component(aboutblurb, main, null);
				append(main, text2);
				mount_component(timeline, main, null);
				append(main, text3);
				mount_component(teams, main, null);
				append(main, text4);
				mount_component(clubleaders, main, null);
				append(main, text5);
				mount_component(getinvolved, main, null);
				append(main, text6);
				mount_component(contactus, main, null);
				current = true;
			},

			p(changed, ctx) {
				if ((!current || changed.increaseStripeAngle) && div_class_value !== (div_class_value = "stripe " + (ctx.increaseStripeAngle ? 'increase-angle' : '') + " svelte-178lsdy")) {
					div.className = div_class_value;
				}
			},

			i(local) {
				if (current) return;
				banner.$$.fragment.i(local);

				aboutblurb.$$.fragment.i(local);

				timeline.$$.fragment.i(local);

				teams.$$.fragment.i(local);

				clubleaders.$$.fragment.i(local);

				getinvolved.$$.fragment.i(local);

				contactus.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				banner.$$.fragment.o(local);
				aboutblurb.$$.fragment.o(local);
				timeline.$$.fragment.o(local);
				teams.$$.fragment.o(local);
				clubleaders.$$.fragment.o(local);
				getinvolved.$$.fragment.o(local);
				contactus.$$.fragment.o(local);
				current = false;
			},

			d(detach) {
				if (detach) {
					detachNode(main);
				}

				banner.$destroy();

				aboutblurb.$destroy();

				timeline.$destroy();

				teams.$destroy();

				clubleaders.$destroy();

				getinvolved.$destroy();

				contactus.$destroy();
			}
		};
	}

	function instance$a($$self, $$props, $$invalidate) {
		

	  let increaseStripeAngle = false;

	  onMount(() => {
	    animationTriggers.subscribe(triggered => {
	      increaseStripeAngle = triggered['#club-leaders']; $$invalidate('increaseStripeAngle', increaseStripeAngle);
	    });
	  });

		return { increaseStripeAngle };
	}

	class Content extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$a, create_fragment$f, safe_not_equal);
		}
	}

	/* src/sections/Footer.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$g(ctx) {
		var footer;

		return {
			c() {
				footer = createElement("footer");
				footer.innerHTML = `<p class="svelte-1yid334">
			    This website was made with love using SvelteJS and some painstaking CSS.
			    <a href="https://github.com/Holben888/gsg-site">Visit the repo</a> to see
			    how it works and fix what's broken 😄
			  </p>`;
				footer.className = "svelte-1yid334";
			},

			m(target, anchor) {
				insert(target, footer, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detach) {
				if (detach) {
					detachNode(footer);
				}
			}
		};
	}

	class Footer extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$g, safe_not_equal);
		}
	}

	/* src/components/ScrollAnimManager.html generated by Svelte v3.0.0-beta.3 */

	// (2:0) {#if !hasScrolled}
	function create_if_block$1(ctx) {
		var div;

		return {
			c() {
				div = createElement("div");
				div.className = "scroll-down-indicator svelte-15zllbi";
			},

			m(target, anchor) {
				insert(target, div, anchor);
			},

			d(detach) {
				if (detach) {
					detachNode(div);
				}
			}
		};
	}

	function create_fragment$h(ctx) {
		var if_block_anchor, dispose;

		var if_block = (!ctx.hasScrolled) && create_if_block$1(ctx);

		return {
			c() {
				if (if_block) if_block.c();
				if_block_anchor = createComment();
				dispose = addListener(window, "scroll", ctx.onScroll);
			},

			m(target, anchor) {
				if (if_block) if_block.m(target, anchor);
				insert(target, if_block_anchor, anchor);
			},

			p(changed, ctx) {
				if (!ctx.hasScrolled) {
					if (!if_block) {
						if_block = create_if_block$1(ctx);
						if_block.c();
						if_block.m(if_block_anchor.parentNode, if_block_anchor);
					}
				} else if (if_block) {
					if_block.d(1);
					if_block = null;
				}
			},

			i: noop,
			o: noop,

			d(detach) {
				if (if_block) if_block.d(detach);

				if (detach) {
					detachNode(if_block_anchor);
				}

				dispose();
			}
		};
	}

	function instance$b($$self, $$props, $$invalidate) {
		

	  let bodyHeight = 0;
	  let hasScrolled = false;
	  let waitingOnAnimRequest = false;

	  onMount(() => {
	    bodyHeight = document.body.clientHeight; $$invalidate('bodyHeight', bodyHeight);
	  });

	  const animChecker = target => {
	    Object.keys($animationTriggers).forEach(selector => {
	      target.querySelectorAll(selector).forEach(element => {
	        const elementTop = element.getBoundingClientRect().top;
	        if (elementTop < bodyHeight * 0.8) {
	          if (!element.classList.contains('scrolled-to')) {
	            element.classList.add('scrolled-to');
	          }
	          animationTriggers.set({
	            ...$animationTriggers,
	            [selector]: true,
	          });
	        } else {
	          animationTriggers.set({
	            ...$animationTriggers,
	            [selector]: false,
	          });
	        }
	      });
	    });
	  };

	  const onScroll = ({ target }) => {
	    if (!waitingOnAnimRequest) {
	      window.requestAnimationFrame(() => {
	        animChecker(target);
	        waitingOnAnimRequest = false; $$invalidate('waitingOnAnimRequest', waitingOnAnimRequest);
	      });
	      waitingOnAnimRequest = true; $$invalidate('waitingOnAnimRequest', waitingOnAnimRequest);
	    }

	    hasScrolled = document.body.scrollTop !== 0; $$invalidate('hasScrolled', hasScrolled);
	  };

		let $animationTriggers;
		$$self.$$.on_destroy.push(animationTriggers.subscribe($$value => { $animationTriggers = $$value; $$invalidate('$animationTriggers', $animationTriggers); }));

		return { hasScrolled, onScroll };
	}

	class ScrollAnimManager extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$b, create_fragment$h, safe_not_equal);
		}
	}

	/* src/index.html generated by Svelte v3.0.0-beta.3 */

	function create_fragment$i(ctx) {
		var text0, text1, text2, current, dispose;

		var scrollanimmanager = new ScrollAnimManager({});

		var navbar = new NavBar({});

		var content = new Content({});

		var footer = new Footer({});

		return {
			c() {
				scrollanimmanager.$$.fragment.c();
				text0 = createText("\n");
				navbar.$$.fragment.c();
				text1 = createText("\n");
				content.$$.fragment.c();
				text2 = createText("\n");
				footer.$$.fragment.c();
				dispose = addListener(window, "load", ctx.load_handler);
			},

			m(target, anchor) {
				mount_component(scrollanimmanager, target, anchor);
				insert(target, text0, anchor);
				mount_component(navbar, target, anchor);
				insert(target, text1, anchor);
				mount_component(content, target, anchor);
				insert(target, text2, anchor);
				mount_component(footer, target, anchor);
				current = true;
			},

			p: noop,

			i(local) {
				if (current) return;
				scrollanimmanager.$$.fragment.i(local);

				navbar.$$.fragment.i(local);

				content.$$.fragment.i(local);

				footer.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				scrollanimmanager.$$.fragment.o(local);
				navbar.$$.fragment.o(local);
				content.$$.fragment.o(local);
				footer.$$.fragment.o(local);
				current = false;
			},

			d(detach) {
				scrollanimmanager.$destroy(detach);

				if (detach) {
					detachNode(text0);
				}

				navbar.$destroy(detach);

				if (detach) {
					detachNode(text1);
				}

				content.$destroy(detach);

				if (detach) {
					detachNode(text2);
				}

				footer.$destroy(detach);

				dispose();
			}
		};
	}

	function instance$c($$self) {

		function load_handler() {
			return document.body.classList.add('ready-for-anim');
		}

		return { load_handler };
	}

	class Index extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$c, create_fragment$i, safe_not_equal);
		}
	}

	const Main = new Index({
	  target: document.body,
	});

	return Main;

}());
