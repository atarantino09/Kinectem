import { motion } from 'framer-motion';

export function Scene5() {
  return (
    <motion.div 
      className="absolute inset-0 bg-white flex flex-col items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
    >
      <motion.img 
        src={`${import.meta.env.BASE_URL}logo-horizontal.png`} 
        alt="Kinectem" 
        className="h-20 mb-12"
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.8, type: "spring" }}
      />
      
      <motion.h2 
        className="text-5xl font-display font-bold text-[#09090B] mb-6 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.8 }}
      >
        <span className="block mb-2">Every game recap. One bigger story.</span>
        <span className="text-transparent bg-clip-text bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)]">
          Your team. Your players. Their whole journey.
        </span>
      </motion.h2>
      
      <motion.p 
        className="text-2xl text-[#71717A] font-bold"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.8 }}
      >
        Start your organization at kinectem.com
      </motion.p>
    </motion.div>
  );
}