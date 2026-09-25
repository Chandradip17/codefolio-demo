import { PHOTOS, unsplash } from './images'

export const CITIES = ['Bengaluru', 'Delhi', 'Pune', 'Hyderabad', 'Mumbai', 'Chennai', 'Kolkata']

export const CHAPTERS = [
  {
    id: 'bengaluru',
    name: 'GDG Bengaluru',
    city: 'Bengaluru',
    image: unsplash(PHOTOS.bengaluru, 700, 420),
    description:
      "India's startup capital. Cloud, Android and AI builders meet here for talks, study jams and late-night hack sprints.",
    tags: ['Cloud', 'Android', 'AI/ML'],
  },
  {
    id: 'delhi',
    name: 'GDG New Delhi',
    city: 'Delhi',
    image: unsplash(PHOTOS.delhi, 700, 420),
    description:
      'The NCR community spanning Delhi, Noida and Gurugram, focused on web, Flutter and a steady stream of campus hackathons.',
    tags: ['Web', 'Flutter', 'Campus'],
  },
  {
    id: 'pune',
    name: 'GDG Pune',
    city: 'Pune',
    image: unsplash(PHOTOS.techTeam, 700, 420),
    description:
      'A hands-on chapter known for code labs, Firebase workshops and a busy calendar of student-led builds.',
    tags: ['Firebase', 'Workshops', 'Students'],
  },
  {
    id: 'hyderabad',
    name: 'GDG Hyderabad',
    city: 'Hyderabad',
    image: unsplash(PHOTOS.openOffice, 700, 420),
    description:
      'From HITEC City offices to college auditoriums: cloud-native, Kubernetes and Gemini deep-dives.',
    tags: ['Kubernetes', 'Gemini', 'DevFest'],
  },
  {
    id: 'mumbai',
    name: 'GDG Mumbai',
    city: 'Mumbai',
    image: unsplash(PHOTOS.mumbai, 700, 420),
    description:
      'Fast-moving meetups by the sea covering mobile, design engineering and fintech-flavoured hackathons.',
    tags: ['Mobile', 'Fintech', 'Design'],
  },
  {
    id: 'chennai',
    name: 'GDG Chennai',
    city: 'Chennai',
    image: unsplash(PHOTOS.chennai, 700, 420),
    description:
      'One of the oldest chapters in the south, with Kotlin and Android roadshows plus a flagship DevFest.',
    tags: ['Kotlin', 'Android', 'DevFest'],
  },
  {
    id: 'kolkata',
    name: 'GDG Kolkata',
    city: 'Kolkata',
    image: unsplash(PHOTOS.kolkata, 700, 420),
    description:
      "The City of Joy's developer hub, with open-source sprints, ML study groups and a growing hackathon scene.",
    tags: ['Open Source', 'ML', 'Hackathons'],
  },
]
