/***************************************************
==================== JS INDEX ======================
****************************************************
01. PreLoader Js
02. Common / Data Attributes Js
03. Dynamic Floating Header Js
04. Services Accordion Js
05. Smooth Scroll Js
06. Skills Tab Marker Js
07. GSAP Core & ScrollSmoother
08. Parallax Elements Js (.parallax-wrap)
09. Services GSAP Animations & Pinning
10. SplitText Title & Text Animations
11. Section Border Scroll Animations
12. Footer Mouse Move Interaction
13. Cursor Tone Switcher (.cursor-style)
****************************************************/

(function ($) {
	"use strict";

	var windowOn = $(window);

	(function () {
		function id(v) { return document.getElementById(v); }
		function loadbar() {
			var ovrl = id("loading"),
				prog = id("tp-loading-line"),
				number = id("tp-loading-number"),
				img = document.images,
				c = 0,
				tot = img.length;
			if (!ovrl || !prog || !number) return;
			if (tot == 0) return doneLoading();

			function imgLoaded() {
				c += 1;
				var perc = ((100 / tot * c) << 0) + "%";
				prog.style.width = perc;
				number.innerHTML = perc;

				if (c === tot) return doneLoading();
			}
			function doneLoading() {

				setTimeout(function () {
					$("#loading").fadeOut(500);
				}, 100);
			}
			for (var i = 0; i < tot; i++) {
				var tImg = new Image();
				tImg.onload = imgLoaded;
				tImg.onerror = imgLoaded;
				tImg.src = img[i].src;
			}
		}
		document.addEventListener('DOMContentLoaded', loadbar, false);
	}());


	$("[data-background").each(function () {
		$(this).css("background-image", "url( " + $(this).attr("data-background") + "  )");
	});

	$("[data-width]").each(function () {
		$(this).css("width", $(this).attr("data-width"));
	});

	$("[data-bg-color]").each(function () {
		$(this).css("background-color", $(this).attr("data-bg-color"));
	});

	$("[data-text-color]").each(function () {
		$(this).css("color", $(this).attr("data-text-color"));
	});


	document.addEventListener("DOMContentLoaded", function () {
		const header = document.querySelector(".header-dynamic");
		const homeLink = document.querySelector(".header-items .header-item:first-child .nav-link-custom");
	
		if (!header) return;
	
		let lastScrollY = window.scrollY;
	
		window.addEventListener("scroll", function () {
			let currentScrollY = window.scrollY;
	
			if (currentScrollY > 100) {
				header.classList.add("header-small");
	
				// Đẩy header về trái hoặc phải dựa vào vị trí
				if (window.innerWidth / 2 < header.getBoundingClientRect().left) {
					header.classList.add("right");
					header.classList.remove("left");
				} else {
					header.classList.add("left");
					header.classList.remove("right");
				}
	
				if (homeLink) homeLink.classList.remove("active"); // Xoá class active khỏi Home
			} else {
				header.classList.remove("header-small", "left", "right");
			}
	
			// Khi cuộn lên → mở rộng lại header ngay lập tức
			if (currentScrollY < lastScrollY) {
				header.classList.remove("header-small", "left", "right");
			}
	
			lastScrollY = currentScrollY;
		});
	
		// Hover vào header nhỏ → mở rộng lại
		header.addEventListener("mouseenter", function () {
			if (header.classList.contains("header-small")) {
				header.classList.remove("header-small", "left", "right");
			}
		});
	
		// Rời chuột → thu nhỏ lại nếu đã scroll (chỉ khi đang ở header nhỏ)
		header.addEventListener("mouseleave", function () {
			if (window.scrollY > 100 && !header.classList.contains("header-small")) {
				header.classList.add("header-small");
	
				if (window.innerWidth / 2 < header.getBoundingClientRect().left) {
					header.classList.add("right");
					header.classList.remove("left");
				} else {
					header.classList.add("left");
					header.classList.remove("right");
				}
			}
		});
	});


	$('.tp-services-accordion-item').on("click", function () {
		$(this).addClass('active').siblings().removeClass('active');
	});


	// 13. Smooth Scroll Js
	function smoothSctoll() {
		$('.smooth a').on('click', function (event) {
			var target = $(this.getAttribute('href'));
			if (target.length) {
				event.preventDefault();
				$('html, body').stop().animate({
					scrollTop: target.offset().top - 120
				}, 1500);
			}
		});
	}
	smoothSctoll();
	

	// skills tab
	if ($('#lineMarker').length > 0) {

		function tp_tab_line_2() {
			var marker = document.querySelector('#lineMarker');
			var item = document.querySelectorAll('.tp-marker-tab button');
			var itemActive = document.querySelector('.tp-marker-tab .nav-link.active');

			function indicator(e) {
				marker.style.left = e.offsetLeft + "px";
				marker.style.width = e.offsetWidth + "px";
			}


			item.forEach(link => {
				link.addEventListener('click', (e) => {
					indicator(e.target);
				});
			});

			var activeNav = $('.nav-link.active');
			var activewidth = $(activeNav).width();
			var activePadLeft = parseFloat($(activeNav).css('padding-left'));
			var activePadRight = parseFloat($(activeNav).css('padding-right'));
			var totalWidth = activewidth + activePadLeft + activePadRight;

			var precedingAnchorWidth = anchorWidthCounter();


			$(marker).css('display', 'block');

			$(marker).css('width', totalWidth);

			function anchorWidthCounter() {
				var anchorWidths = 0;
				var a;
				var aWidth;
				var aPadLeft;
				var aPadRight;
				var aTotalWidth;
				$('.tp-marker-tab button').each(function (index, elem) {
					var activeTest = $(elem).hasClass('active');
					marker.style.left = elem.offsetLeft + "px";
					if (activeTest) {
						// Break out of the each function.
						return false;
					}

					a = $(elem).find('button');
					aWidth = a.width();
					aPadLeft = parseFloat(a.css('padding-left'));
					aPadRight = parseFloat(a.css('padding-right'));
					aTotalWidth = aWidth + aPadLeft + aPadRight;

					anchorWidths = anchorWidths + aTotalWidth;

				});

				return anchorWidths;
			}
		}
		tp_tab_line_2();
	}


	gsap.registerPlugin(ScrollTrigger, ScrollSmoother, TweenMax);
	
	gsap.config({
		nullTargetWarn: false,
	});

	let smoother = ScrollSmoother.create({
		smooth: 2,
		effects: true,
		smoothTouch: 0.1,
		normalizeScroll: false,
		ignoreMobileResize: true,
	});


	/* services animation start */
	gsap.set('.tp-services-bg-text', {
		x: window.innerWidth / 4
	});

	gsap.timeline({
		scrollTrigger: {
			trigger: '.tp-services-bg-text-animation',
			// start: '0% 0%',
			// end: 'bottom -10%',
			start: 'top 90%', 
			end: 'top 40%',
			scrub: true,
			invalidateOnRefresh: true
		}
	})
		.to('.tp-services-bg-text', {
			x: () => -window.innerWidth / 35
		});


	// button effect
	var mouse = { x: 0, y: 0 };
	var pos = { x: 0, y: 0 };
	var ratio = 0.65;
	var active = false;

	var allParalax = document.querySelectorAll('.parallax-wrap');

	allParalax.forEach(function (e) {
		e.addEventListener("mousemove", mouseMoveBtn);
	})

	function mouseMoveBtn(e) {
		var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
		mouse.x = e.pageX;
		mouse.y = e.pageY - scrollTop;

	}
	gsap.ticker.add(updatePosition);

	$(".parallax-wrap").mouseenter(function (e) {
		gsap.to(this, { duration: 0.3, scale: 2 });
		gsap.to($(this).children(), { duration: 0.3, scale: 0.5 });
		active = true;
	});

	$(".parallax-wrap").mouseleave(function (e) {
		gsap.to(this, { duration: 0.3, scale: 1 });
		gsap.to($(this).children(), { duration: 0.3, scale: 1, x: 0, y: 0 });
		active = false;
	});

	function updatePosition() {
		pos.x += (mouse.x - pos.x) * ratio;
		pos.y += (mouse.y - pos.y) * ratio;

	}


	$(".parallax-wrap").mousemove(function (e) {
		parallaxCursorBtn(e, this, 2);
		callParallaxBtn(e, this);
	});

	function callParallaxBtn(e, parent) {
		parallaxItBtn(e, parent, parent.querySelector(".parallax-element"), 20);
	}

	function parallaxItBtn(e, parent, target, movement) {
		var boundingRect = parent.getBoundingClientRect();
		var relX = e.pageX - boundingRect.left;
		var relY = e.pageY - boundingRect.top;
		var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

		gsap.to(target, {
			duration: 0.3,
			x: (relX - boundingRect.width / 2) / boundingRect.width * movement,
			y: (relY - boundingRect.height / 2 - scrollTop) / boundingRect.height * movement,
			ease: Power2.easeOut
		});
	}

	function parallaxCursorBtn(e, parent, movement) {
		var rect = parent.getBoundingClientRect();
		var relX = e.pageX - rect.left;
		var relY = e.pageY - rect.top;
		var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
		pos.x = rect.left + rect.width / 2 + (relX - rect.width / 2) / movement;
		pos.y = rect.top + rect.height / 2 + (relY - rect.height / 2 - scrollTop) / movement;
	}


	// footer btn move

	var footerBtnSection = $('.tp-mouse-move-btn-section');
	var footerBtn = $('.tp-mouse-move-btn');

	footerBtnSection.on("mousemove", function (e) {

		var x = e.clientX
		var y = e.clientY
		let viewportWidth = window.innerWidth;
		let viewportHeight = window.innerHeight;
		let center = viewportWidth / 2
		let centerHeight = innerHeight / 2

		if (x > center) {
			gsap.to(footerBtn, {
				x: 100,
				duration: 2,
				ease: "power4.out"
			})
		}
		else {
			gsap.to(footerBtn, {
				x: -100,
				duration: 2,
				ease: "power4.out"
			})
		}
		if (y > centerHeight) {
			gsap.to(footerBtn, {
				y: 100,
				duration: 2,
				ease: "power4.out"
			})
		}
		else {
			gsap.to(footerBtn, {
				y: -100,
				duration: 2,
				ease: "power4.out"
			})
		}

	})

	if ($('.tp-service-3__area').length > 0) {
		let mm = gsap.matchMedia();
		mm.add("(min-width: 991px)", () => {
			gsap.to('.services-panel-pin', {
				opacity: 1,
				scrollTrigger: {
					trigger: '.tp-service-3__area',
					scrub: 1,
					start: 'top -7%',
					end: "bottom 63%",
					pin: '.services-panel-pin',
					markers: false,
				}
			})
		})
	}

	// portfolio panel
	let otherSections = document.querySelectorAll('.portfolio-panel');

	if (otherSections.length > 0) {
		let tl = gsap.timeline();

		otherSections.forEach((section, index) => {
			gsap.set(otherSections, {
				scale: 1
			});

			tl.to(section, {
				scale: .8,
				scrollTrigger: {
					trigger: section,
					pin: section,
					scrub: 1,
					start: 'top 10%',
					end: "bottom 60%",
					endTrigger: '.tp-project-3__area',
					pinSpacing: false,
					markers: false,
				},
			});
		});
	}

	if ($('.tp_title_anim').length > 0) {
		let splitTitleLines = gsap.utils.toArray(".tp_title_anim");
		splitTitleLines.forEach(splitTextLine => {
			const tl = gsap.timeline({
				scrollTrigger: {
					trigger: splitTextLine,
					// start: 'top 90%',
					// end: 'bottom 60%',
					start: 'top 85%',
					end: 'bottom 60%',
					scrub: false,
					markers: false,
					toggleActions: 'play none none none'
				}
			});

			const itemSplitted = new SplitText(splitTextLine, { type: "words, lines" });
			gsap.set(splitTextLine, { perspective: 400 });
			itemSplitted.split({ type: "lines" })
			tl.from(itemSplitted.lines, {
				duration: 1,
				delay: 0.3,
				opacity: 0,
				rotationX: -80,
				force3D: true,
				transformOrigin: "top center -50",
				stagger: 0.1
			});
		});
	}


	if ($('.tp_text_anim p').length > 0) {
		let splitTextLines = gsap.utils.toArray(".tp_text_anim p");

		splitTextLines.forEach(splitTextLine => {
			const tl = gsap.timeline({
				scrollTrigger: {
					trigger: splitTextLine,
					// start: 'top 90%',
					// duration: 2,
					// end: 'bottom 60%',
					start: 'top 82%',
					duration: 2,
					end: 'bottom 57%',
					scrub: false,
					markers: false,
					toggleActions: 'play none none none'
				}
			});

			const itemSplitted = new SplitText(splitTextLine, { type: "lines" });
			gsap.set(splitTextLine, { perspective: 400 });
			itemSplitted.split({ type: "lines" })
			tl.from(itemSplitted.lines, {
				duration: 1,
				delay: 0.7,
				opacity: 0,
				rotationX: -80,
				force3D: true,
				transformOrigin: "top center -50",
				stagger: 0.1
			});
		});
	}


	// for services
	let allServicesHorizontalBorder = document.querySelectorAll('.tp-services-inner-border');

	allServicesHorizontalBorder.forEach((line, index) => {
		gsap.set(line, {
			height: 0
		});
		gsap.to(line, {
			scrollTrigger: {
				trigger: line,
				start: 'top 60%',
				end: "bottom 80%",
			},
			height: "100%"
		});
	});

	// services accordion
	let allServicesAccordion = document.querySelectorAll('.tp-services-accordion-border');

	allServicesAccordion.forEach((line, index) => {
		gsap.set(line, {
			height: 0
		});
		gsap.to(line, {
			scrollTrigger: {
				trigger: line,
				start: 'top 60%',
				end: "bottom 80%",
			},
			height: "100%"
		});
	});


	// services accordion
	let allServicesAccordionItem = document.querySelectorAll('.accordion-item-border');

	allServicesAccordionItem.forEach((line, index) => {
		gsap.set(line, {
			width: 0
		});
		gsap.to(line, {
			scrollTrigger: {
				trigger: '.tp-services-accordion',
				start: 'top 40%',
				end: "bottom 80%",
			},
			width: "100%"
		});
	});


	// services accordion
	let aboutLine = document.querySelectorAll('.tp-about-inner-border');

	aboutLine.forEach((line, index) => {
		gsap.set(line, {
			width: 0
		});
		gsap.to(line, {
			scrollTrigger: {
				trigger: '.tp-about-inner',
				start: 'top 40%',
				end: "bottom 80%",
				markers: false,
			},
			width: "100%"
		});
	});


	if ($('.tp-char-animation').length > 0) {
		// 25. Title Animation
		let char_come = gsap.utils.toArray(".tp-char-animation");
		char_come.forEach(splitTextLine => {
			const tl = gsap.timeline({
				scrollTrigger: {
					trigger: splitTextLine,
					start: 'top 90%',
					end: 'bottom 60%',
					scrub: false,
					markers: false,
					toggleActions: 'play none none none'
				}
			});

			const itemSplitted = new SplitText(splitTextLine, { type: "chars, words" });
			gsap.set(splitTextLine, { perspective: 300 });
			itemSplitted.split({ type: "chars, words" })
			tl.from(itemSplitted.chars,
				{
					duration: 1,
					delay: 0.5,
					x: 100,
					autoAlpha: 0,
					stagger: 0.05
				});
		});
	}

	if ($('.tp-hero-3__title span').length > 0) {

		gsap.set(".tp-hero-3__title span", { scale: .5, opacity: 0 });
		gsap.to(".tp-hero-3__title span", {
			scrollTrigger: {
				trigger: ".tp-hero-3__title",
				start: "center center",
				markers: false
			},
			duration: 1.3,
			delay: 1,
			ease: "none",
			scale: 1,
			opacity: 1,
		})

	}

	if ($('.tp_wrap_anim').length > 0) {
		// 25. Title Animation
		let char_come = gsap.utils.toArray(".tp_wrap_anim p");
		char_come.forEach(splitTextLine => {
			const tl = gsap.timeline({
				scrollTrigger: {
					trigger: splitTextLine,
					start: 'top 90%',
					end: 'bottom 60%',
					scrub: false,
					markers: false,
					toggleActions: 'play none none none'
				}
			});

			const itemSplitted = new SplitText(splitTextLine, { type: "chars, words" });
			gsap.set(splitTextLine, { perspective: 300 });
			itemSplitted.split({ type: "chars, words" })
			tl.from(itemSplitted.words,
				{
					duration: 1,
					delay: 1,
					x: 100,
					autoAlpha: 0,
					stagger: 0.05
				});
		});
	}


	$('.cursor-style').on("mouseenter", function () {
		$('body').addClass('cursor-white')
	});
	$('.cursor-style').on("mouseleave", function () {
		$('body').removeClass('cursor-white')
	});


})(jQuery);
