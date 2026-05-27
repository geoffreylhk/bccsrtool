(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = Boolean(window.gsap && window.ScrollTrigger);

  if (reducedMotion || !hasGsap) {
    document.documentElement.style.setProperty('--story-progress', '1');
    document.documentElement.style.setProperty('--measure-progress', '1');
    return;
  }

  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add('animations-ready');

  let lenis = null;
  if (window.Lenis) {
    lenis = new window.Lenis({
      lerp: 0.08,
      wheelMultiplier: 0.85,
      smoothWheel: true
    });

    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
  }

  const revealItems = gsap.utils.toArray('[data-reveal]');

  gsap.set(revealItems, { opacity: 0, y: 34 });

  revealItems.forEach((element) => {
    gsap.to(element, {
      opacity: 1,
      y: 0,
      duration: 0.82,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: element,
        start: 'top 82%',
        once: true
      }
    });
  });

  const story = document.querySelector('.scroll-story');
  const steps = gsap.utils.toArray('.workflow-step-card');

  if (story && steps.length) {
    ScrollTrigger.create({
      trigger: story,
      start: 'top center',
      end: 'bottom center',
      scrub: 0.2,
      onUpdate: (self) => {
        const progress = Math.max(0.08, self.progress);
        story.style.setProperty('--story-progress', progress.toFixed(3));

        const activeIndex = Math.min(
          steps.length - 1,
          Math.max(0, Math.floor(self.progress * steps.length))
        );

        steps.forEach((step, index) => {
          step.classList.toggle('is-active', index === activeIndex);
          step.classList.toggle('is-complete', index < activeIndex);
        });
      }
    });
  }

  gsap.fromTo(
    '.threshold-demo',
    { '--measure-progress': 0.18 },
    {
      '--measure-progress': 1,
      duration: 1,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: '.threshold-demo',
        start: 'top 72%',
        once: true
      }
    }
  );

  gsap.fromTo(
    '.esa-flow-v2 li',
    { opacity: 0, y: 24 },
    {
      opacity: 1,
      y: 0,
      duration: 0.72,
      ease: 'power2.out',
      stagger: 0.1,
      scrollTrigger: {
        trigger: '.esa-flow-v2',
        start: 'top 78%',
        once: true
      }
    }
  );
})();
