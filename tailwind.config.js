const fs = require('fs');
const colors = JSON.parse(
  fs.readFileSync('colors.json', { encoding: 'utf-8' })
);

module.exports = {
  darkMode: ['class', 'class'],
  content: [
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './fyo/**/*.{vue,js,ts,jsx,tsx}',
    './index.html',
  ],
  theme: {
  	fontFamily: {
  		sans: [
  			'Inter',
  			'Segoe UI',
  			'-apple-system',
  			'BlinkMacSystemFont',
  			'Roboto',
  			'sans-serif'
  		]
  	},
  	screens: {
  		sm: '640px',
  		md: '768px',
  		lg: '1024px',
  		xl: '1280px'
  	},
  	fontSize: {
  		xs: '12px',
  		sm: '13px',
  		base: '14px',
  		lg: '15px',
  		xl: '18px',
  		'2xl': '20px',
  		'3xl': '24px',
  		'4xl': '28px'
  	},
  	extend: {
  		maxHeight: {
  			'64': '16rem'
  		},
  		minWidth: {
  			'40': '10rem',
  			'56': '14rem'
  		},
  		maxWidth: {
  			'32': '8rem',
  			'56': '14rem'
  		},
  		spacing: {
  			'7': '1.75rem',
  			'14': '3.5rem',
  			'18': '4.5rem',
  			'28': '7rem',
  			'72': '18rem',
  			'80': '20rem'
  		},
  		boxShadow: {
  			'outline-px': '0 0 0 1px rgba(66, 153, 225, 0.5)',
  			DEFAULT: '0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  			md: '0 0 2px 0 rgba(0, 0, 0, 0.10), 0 2px 4px 0 rgba(0, 0, 0, 0.08)',
  			button: '0 0.5px 0 0 rgba(0, 0, 0, 0.08)'
  		},
  		borderRadius: {
  			sm: 'calc(var(--radius) - 4px)',
  			DEFAULT: '0.313rem',
  			md: 'calc(var(--radius) - 2px)',
  			lg: 'var(--radius)',
  			xl: '0.75rem'
  		},
  		gridColumn: {
  			'span-full': '1 / -1'
  		},
  		colors: {
                ...colors,
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'fade-in': {
  				from: {
  					opacity: '0'
  				},
  				to: {
  					opacity: '1'
  				}
  			},
  			'fade-out': {
  				from: {
  					opacity: '1'
  				},
  				to: {
  					opacity: '0'
  				}
  			},
  			'zoom-in': {
  				from: {
  					opacity: '0',
  					transform: 'scale(0.95)'
  				},
  				to: {
  					opacity: '1',
  					transform: 'scale(1)'
  				}
  			},
  			'zoom-out': {
  				from: {
  					opacity: '1',
  					transform: 'scale(1)'
  				},
  				to: {
  					opacity: '0',
  					transform: 'scale(0.95)'
  				}
  			},
  			'slide-in-from-top': {
  				from: {
  					transform: 'translateY(-4px)',
  					opacity: '0'
  				},
  				to: {
  					transform: 'translateY(0)',
  					opacity: '1'
  				}
  			},
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--reka-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--reka-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'fade-in': 'fade-in 150ms ease-out',
  			'fade-out': 'fade-out 150ms ease-in',
  			'zoom-in': 'zoom-in 150ms ease-out',
  			'zoom-out': 'zoom-out 150ms ease-in',
  			'slide-in-from-top': 'slide-in-from-top 150ms ease-out',
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require('tailwindcss-rtl'), require("tailwindcss-animate")],
};

/*
 * 208, 100, 50
 * 209,  62, 50
 */
